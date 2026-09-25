param(
  [string]$TargetRoot = "C:\VIBE\PROJETOS",
  [string]$RepoUrl = "https://github.com/axionconstrucoes/axion-contract-intelligence.git"
)

$ErrorActionPreference = "Stop"

function Require-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Ferramenta obrigatória ausente: $Name"
  }
}

Require-Command git
Require-Command node
Require-Command npm

$nodeVersion = (node --version).Trim()
$npmVersion = (npm --version).Trim()
$gitVersion = (git --version).Trim()

Write-Host ""
Write-Host "AXION ACC - PREPARACAO DE NOVO PC"
Write-Host "================================"
Write-Host "Git : $gitVersion"
Write-Host "Node: $nodeVersion"
Write-Host "npm : $npmVersion"
Write-Host ""

New-Item -ItemType Directory -Force -Path $TargetRoot | Out-Null

$repoPath = Join-Path $TargetRoot "axion-contract-intelligence"

if (-not (Test-Path (Join-Path $repoPath ".git"))) {
  Write-Host "Clonando repositorio em $repoPath ..."
  git clone $RepoUrl $repoPath
} else {
  Write-Host "Repositorio ja existe. Atualizando..."
}

Set-Location $repoPath

git fetch origin
git switch main
git pull --ff-only origin main

Write-Host ""
Write-Host "Instalando dependencias..."
npm ci

$envPath = Join-Path $repoPath "apps\web\.env.local"

Write-Host ""
if (Test-Path $envPath) {
  Write-Host "apps/web/.env.local: ENCONTRADO"
} else {
  Write-Warning "apps/web/.env.local: AUSENTE"
  Write-Warning "O arquivo contem segredos e NAO fica no GitHub."
  Write-Warning "Copie-o de forma segura do PC anterior ou recrie as variaveis necessarias."
}

Write-Host ""
Write-Host "Estado Git:"
git status -sb

Write-Host ""
Write-Host "Preparacao concluida."
Write-Host "Repositorio: $repoPath"
Write-Host ""
Write-Host "Para iniciar o ACC localmente:"
Write-Host "  cd $repoPath"
Write-Host "  npm run dev"
Write-Host ""
Write-Host "Depois abra: http://localhost:3000"
