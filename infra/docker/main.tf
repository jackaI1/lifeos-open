terraform {
  required_version = ">= 1.6"
  required_providers {
    docker = {
      source  = "kreuzwerker/docker"
      version = "~> 3.6"
    }
  }
}
provider "docker" {}
variable "image" {
  type        = string
  description = "Locally built LifeOS public-demo image tag"
  default     = "lifeos-public:terraform"
}
variable "port" {
  type        = number
  description = "Loopback host port"
  default     = 18080
  validation {
    condition     = var.port >= 1024 && var.port <= 65535
    error_message = "Use a nonprivileged TCP port."
  }
}
variable "name" {
  type        = string
  description = "Owned container name"
  default     = "lifeos-terraform-demo"
}
resource "docker_container" "demo" {
  name      = var.name
  image     = var.image
  read_only = true
  restart   = "no"
  ports {
    internal = 8080
    external = var.port
    ip       = "127.0.0.1"
  }
  capabilities {
    drop = ["ALL"]
  }
  security_opts = ["no-new-privileges:true"]
  env           = ["PARENT_ORIGIN=https://jacklai.ca"]
}
output "url" {
  value       = "http://127.0.0.1:${var.port}"
  description = "Public demo address on this machine"
}
output "container_id" {
  value       = docker_container.demo.id
  description = "Exact container owned by this module"
}
