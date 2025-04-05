variable "cloudflare_zone_id" {
 type        = string
 description = "Cloudflare Zone ID for the domain (provided by Flux TF object)"
}


variable "metallb_ip" {
  type        = string
  description = "The External IP assigned by MetalLB to ingress-nginx"
  default     = "10.254.250.0"
}

variable "domain_name" {
  type        = string
  description = "domain name"
  default     = "khzaw.dev"
}
