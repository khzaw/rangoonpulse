.PHONY: help status flux-status hr-status events nodes pods
.PHONY: reconcile reconcile-all deploy-blog deploy-mmcal
.PHONY: image-repos image-policies image-updates
.PHONY: talos-dashboard logs

PRIMARY_NODE := 10.0.0.197
PI_NODE := 10.0.0.38

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

# --- Status ---

status: ## Flux overall health
	flux get kustomizations

hr-status: ## All HelmReleases
	flux get hr -A

events: ## Recent cluster events
	kubectl get events -A --sort-by=.lastTimestamp | tail -40

nodes: ## Node status and resources
	kubectl get nodes -o wide
	@echo ""
	kubectl top nodes

pods: ## All pods sorted by namespace
	kubectl get pods -A --sort-by=.metadata.namespace

pods-flux: ## Flux system pods
	kubectl get pods -n flux-system

# --- Reconciliation ---

reconcile: ## Reconcile a kustomization (usage: make reconcile NAME=blog)
	flux reconcile kustomization $(NAME) --with-source

reconcile-all: ## Force reconcile all kustomizations from git source
	flux reconcile source git flux-system
	flux reconcile kustomization flux-system --with-source

# --- Image Automation ---

image-repos: ## Show image repository scan status
	flux get image repository -A

image-policies: ## Show resolved image tags
	flux get image policy -A

image-updates: ## Show image update automation status
	flux get image update -A

deploy-blog: ## Force deploy latest blog image now
	flux reconcile image repository blog
	@sleep 2
	flux reconcile image update flux-system

deploy-mmcal: ## Force deploy latest mmcal image now
	flux reconcile image repository mmcal
	@sleep 2
	flux reconcile image update flux-system

# --- Logs ---

logs: ## Tail logs for an app (usage: make logs NAME=blog)
	kubectl logs -l app.kubernetes.io/name=$(NAME) -f --tail=50

logs-flux: ## Tail Flux kustomize-controller logs
	kubectl logs -n flux-system deploy/kustomize-controller -f --tail=50

logs-image: ## Tail image-automation-controller logs
	kubectl logs -n flux-system deploy/image-automation-controller -f --tail=50

# --- Talos ---

talos-dashboard: ## Open Talos dashboard for primary node
	talosctl -n $(PRIMARY_NODE) dashboard

talos-dashboard-pi: ## Open Talos dashboard for Pi node
	talosctl -n $(PI_NODE) dashboard

# --- Validation ---

validate: ## Dry-run validate a manifest (usage: make validate FILE=apps/blog/helmrelease.yaml)
	kubectl apply --dry-run=client -f $(FILE)
