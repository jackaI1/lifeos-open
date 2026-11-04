variable "aws_region" {
  description = "Deployment region; use the same region in GitHub Actions."
  type        = string
  default     = "us-east-1"
}

variable "name" {
  description = "Dedicated resource prefix (not an existing private deployment)."
  type        = string
  default     = "lifeos-open-demo"
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{3,30}$", var.name))
    error_message = "Use 4-31 lowercase letters, numbers or hyphens, starting with a letter."
  }
}

variable "github_repository" {
  description = "Only this GitHub repository may assume the release role."
  type        = string
  default     = "jackaI1/lifeos-open"
  validation {
    condition     = can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.github_repository))
    error_message = "Use an exact owner/repository, without wildcards."
  }
}

variable "existing_oidc_provider_arn" {
  description = "Use an existing GitHub OIDC provider instead of creating the account-wide provider."
  type        = string
  default     = null
  validation {
    condition     = var.existing_oidc_provider_arn == null ? true : can(regex("^arn:[^:]+:iam::[0-9]{12}:oidc-provider/token\\.actions\\.githubusercontent\\.com$", var.existing_oidc_provider_arn))
    error_message = "Expected the exact GitHub Actions OIDC provider ARN."
  }
}

variable "parent_origin" {
  description = "HTTPS portfolio origin allowed to frame the demo. No paths or trailing slash."
  type        = string
  default     = "https://owner.example.invalid"
  validation {
    condition     = can(regex("^https://[A-Za-z0-9.-]+(:[0-9]+)?$", var.parent_origin)) && var.parent_origin != "https://demo.example.invalid"
    error_message = "Use a distinct HTTPS origin, such as https://portfolio.example.invalid."
  }
}

variable "image_tag" {
  description = "Initially null: provision ECR/IAM only. Set to a pushed immutable aws-<commit SHA> tag to create the HTTPS ECS service. Later image updates belong to the release workflow."
  type        = string
  default     = null
  validation {
    condition     = var.image_tag == null ? true : can(regex("^aws-[a-f0-9]{40}$", var.image_tag))
    error_message = "Use aws- followed by a full lowercase 40-character Git commit SHA."
  }
}
