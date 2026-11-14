output "public_ip" {
  value = aws_eip.this.public_ip
}

output "domain" {
  value = var.domain
}

output "ssh" {
  value = "ssh ubuntu@${aws_eip.this.public_ip}"
}

output "ws_url" {
  value = "wss://${var.domain}"
}
