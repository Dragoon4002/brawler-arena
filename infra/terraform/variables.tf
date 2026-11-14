variable "region" {
  type    = string
  default = "us-east-1"
}

variable "name" {
  type    = string
  default = "brawler-arena"
}

variable "instance_type" {
  type    = string
  default = "t4g.small"
}

variable "ssh_cidr" {
  description = "CIDR allowed to SSH, e.g. 203.0.113.4/32"
  type        = string

  validation {
    condition     = can(cidrhost(var.ssh_cidr, 0))
    error_message = "ssh_cidr must be a valid CIDR."
  }
}

variable "ssh_public_key" {
  description = "Path to SSH public key"
  type        = string
  default     = "~/.ssh/id_ed25519.pub"
}

variable "domain" {
  description = "Public hostname for the WS server, e.g. ws.example.com"
  type        = string
}

variable "route53_zone_id" {
  description = "If set, creates an A record for domain in this zone"
  type        = string
  default     = null
}
