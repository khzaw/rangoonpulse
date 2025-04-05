data "cloudflare_zone" "primary" {
  name    = var.domain_name
}

resource "cloudflare_record" "longhorn" {
  zone_id = data.cloudflare_zone.primary.id
  name    = "longhorn"
  value   = var.metallb_ip
  type    = "A"
  ttl     = 1
  proxied = false
}

resource "cloudflare_record" "uptime_kuma" {
  zone_id = data.cloudflare_zone.primary.id
  name    = "uptime-kuma"
  value   = var.metallb_ip
  type    = "A"
  ttl     = 1
  proxied = false
}


resource "cloudflare_record" "calibre_manage" {
  zone_id = data.cloudflare_zone.primary.id
  name    = "calibre-manage"
  value   = var.metallb_ip
  type    = "A"
  ttl     = 1
  proxied = false
}

resource "cloudflare_record" "calibre_web" {
  zone_id = data.cloudflare_zone.primary.id
  name    = "calibre"
  value   = var.metallb_ip
  type    = "A"
  ttl     = 1
  proxied = false
}

resource "cloudflare_record" "actual_budget" {
  zone_id = data.cloudflare_zone.primary.id
  name    = "budget"
  value   = var.metallb_ip
  type    = "A"
  ttl     = 1
  proxied = false
}
