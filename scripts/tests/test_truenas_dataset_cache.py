"""PVC dataset metrics share one bounded TrueNAS read between scrapes."""

import importlib.util
import os
import sys
import unittest
import urllib.parse
from pathlib import Path
from unittest import mock

try:
    from . import truenas_exporter_fixture as fixture
except ImportError:
    import truenas_exporter_fixture as fixture

POWER = Path(fixture.EXPORTER).with_name("power.py")


class Clock:
    def __init__(self):
        self.now = 1000.0

    def monotonic(self):
        return self.now

    def time(self):
        return 1793264400 + self.now


def load_exporter():
    with mock.patch.dict(os.environ, fixture.fixture_environment(), clear=True):
        power_spec = importlib.util.spec_from_file_location("power", POWER)
        power = importlib.util.module_from_spec(power_spec)
        power_spec.loader.exec_module(power)
        spec = importlib.util.spec_from_file_location("exporter_cache_fixture", fixture.EXPORTER)
        module = importlib.util.module_from_spec(spec)
        with mock.patch.dict(sys.modules, {"power": power}):
            spec.loader.exec_module(module)
    return module


def pv(name, dataset):
    return {"metadata": {"name": name}, "spec": {
        "csi": {"driver": "org.democratic-csi.nfs-hdd", "volumeAttributes": {"share": f"/mnt/{dataset}"}},
        "claimRef": {"namespace": "default", "name": name}, "storageClassName": "truenas-nfs"}}


class DatasetCacheTests(unittest.TestCase):
    def setUp(self):
        self.module = load_exporter()
        self.clock = Clock()
        self.reads = []
        self.fail = False

        def fetch():
            if self.fail:
                raise TimeoutError("NAS offline")
            self.reads.append(self.clock.now)
            return [{"name": "tank/a", "usedbydataset": {"parsed": 10 * len(self.reads)}, "available": 90},
                    {"name": "tank/b", "usedbydataset": 5, "available": 95, "refquota": {"rawvalue": "50"}}]

        self.cache = self.module.DatasetCache(fetch, clock=self.clock)

    def test_defaults_poll_far_less_than_the_scrape_interval(self):
        self.assertEqual(self.module.DATASET_REFRESH_SECONDS, 900)
        self.assertEqual(self.module.DATASET_MIN_REFRESH_SECONDS, 110)
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(self.module.DATASET_QUERY).query)
        self.assertEqual(urllib.parse.urlsplit(self.module.DATASET_QUERY).path, "/pool/dataset")
        self.assertEqual(query["extra.flat"], ["true"])
        self.assertEqual(query["extra.properties"], ["usedbydataset,available,refquota,quota"])
        self.assertEqual(query["extra.retrieve_user_props"], ["false"])

    def test_scrapes_reuse_one_read_until_it_is_due(self):
        for _ in range(8):  # 120-second scrapes for 15 minutes.
            fetched_at, datasets = self.cache.get(frozenset({"a"}))
            self.assertEqual(fetched_at, 1793265400)
            self.assertIn("tank/a", datasets)
            self.clock.now += 120
        self.assertEqual(self.reads, [1000.0])
        self.cache.get(frozenset({"a"}))
        self.assertEqual(self.reads, [1000.0, 1960.0])

    def test_new_volume_refreshes_early_but_at_most_once_per_scrape_interval(self):
        self.cache.get(frozenset({"a"}))
        self.clock.now += 60
        self.cache.get(frozenset({"a", "b"}))  # Too soon after the last read.
        self.assertEqual(len(self.reads), 1)
        self.clock.now += 60
        self.cache.get(frozenset({"a", "b"}))
        self.assertEqual(len(self.reads), 2)
        # A volume whose dataset never appears does not force repeated reads.
        self.clock.now += 120
        self.cache.get(frozenset({"a", "b"}))
        self.cache.get(frozenset({"a"}))
        self.assertEqual(len(self.reads), 2)

    def test_failed_read_raises_and_is_retried_on_the_next_scrape(self):
        self.cache.get(frozenset({"a"}))
        self.clock.now += 900
        self.fail = True
        with self.assertRaises(TimeoutError):
            self.cache.get(frozenset({"a"}))
        self.fail = False
        self.clock.now += 120
        self.cache.get(frozenset({"a"}))
        self.assertEqual(self.reads, [1000.0, 2020.0])

    def test_metrics_report_cached_values_with_their_read_time(self):
        self.module.DATASETS = self.cache
        self.module._kube_get = mock.Mock(return_value={"items": [pv("a", "tank/a"), pv("b", "tank/b"),
                                                                  pv("gone", "tank/gone")]})
        first = self.module._collect().decode()
        self.clock.now += 120
        second = self.module._collect().decode()
        self.assertEqual(first, second)
        self.assertEqual(len(self.reads), 1)
        self.assertIn('truenas_pvc_dataset_used_bytes{dataset="tank/a",namespace="default",'
                      'persistentvolume="a",persistentvolumeclaim="a",pool="tank",storageclass="truenas-nfs"} 10',
                      second)
        self.assertIn('truenas_pvc_dataset_capacity_bytes{dataset="tank/b",namespace="default",'
                      'persistentvolume="b",persistentvolumeclaim="b",pool="tank",storageclass="truenas-nfs"} 50',
                      second)
        self.assertIn('truenas_pvc_dataset_last_scrape_timestamp_seconds{dataset="tank/a",namespace="default",'
                      'persistentvolume="a",persistentvolumeclaim="a",pool="tank",storageclass="truenas-nfs"} 1793265400',
                      second)
        self.assertIn('error="KeyError"', second)


if __name__ == "__main__":
    unittest.main()
