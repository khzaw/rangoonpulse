data "cloudflare_zone" "primary" {
  name    = var.domain_name
}

resource "cloudflare_record" "longhorn" {
  zone_id = data.cloudflare_zone.primary.id
  name    = "longhorn"
  content = var.metallb_ip
  type    = "A"
  ttl     = 1
  proxied = false
}

resource "cloudflare_record" "uptime_kuma" {
  zone_id = data.cloudflare_zone.primary.id
  name    = "uptime-kuma"
  content = var.metallb_ip
  type    = "A"
  ttl     = 1
  proxied = false
}


resource "cloudflare_record" "calibre_manage" {
  zone_id = data.cloudflare_zone.primary.id
  name    = "calibre-manage"
  content = var.metallb_ip
  type    = "A"
  ttl     = 1
  proxied = false
}

resource "cloudflare_record" "calibre_web" {
  zone_id = data.cloudflare_zone.primary.id
  name    = "calibre"
  content = var.metallb_ip
  type    = "A"
  ttl     = 1
  proxied = false
}

resource "cloudflare_record" "actual_budget" {
  zone_id = data.cloudflare_zone.primary.id
  name    = "actual"
  content = var.metallb_ip
  type    = "A"
  ttl     = 1
  proxied = false
}

resource "cloudflare_record" "ghost" {
  zone_id = data.cloudflare_zone.primary.id
  name = "blog"
  value = var.metallb_ip
  type = "A"
  ttl = 1
  proxied = false
}
