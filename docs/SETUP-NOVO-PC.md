# ACC — Retomada em outro PC

Este documento permite continuar o trabalho do AXION ACC em outro computador Windows sem depender do estado local do PC anterior.

## Estado de referência

- Repositório: `axionconstrucoes/axion-contract-intelligence`
- Branch operacional: `main`
- Produção: `https://acc.axion.com.br`
- Supabase: projeto `axion-contract-intelligence-dev`
- O código, migrations e histórico estão no GitHub/Supabase. Não copie a pasta `.git` manualmente entre computadores.
- O arquivo `apps/web/.env.local` contém segredos e não é versionado.

## Requisitos do novo PC

Instale antes:

- Git for Windows
- Node.js 24.x
- npm 11.x

Versões que já foram usadas com sucesso no projeto:

- Node 24.19.0
- npm 11.17.0
- Git 2.55.0

## Instalação automática

Abra PowerShell e execute:

```powershell
New-Item -ItemType Directory -Force C:\VIBE\PROJETOS | Out-Null
cd C:\VIBE\PROJETOS
git clone https://github.com/axionconstrucoes/axion-contract-intelligence.git
cd .\axion-contract-intelligence
powershell -ExecutionPolicy Bypass -File .\scripts\setup-new-pc.ps1
```

Se o repositório já existir no novo PC:

```powershell
cd C:\VIBE\PROJETOS\axion-contract-intelligence
powershell -ExecutionPolicy Bypass -File .\scripts\setup-new-pc.ps1
```

## Arquivo .env.local

O GitHub NÃO contém `apps/web/.env.local`.

No novo PC, coloque o arquivo em:

```text
C:\VIBE\PROJETOS\axion-contract-intelligence\apps\web\.env.local
```

Não envie esse arquivo por commit, PR ou pasta pública.

Depois confirme apenas a presença:

```powershell
Test-Path .\apps\web\.env.local
```

Resultado esperado:

```text
True
```

## Retomar o desenvolvimento

```powershell
cd C:\VIBE\PROJETOS\axion-contract-intelligence
git switch main
git pull --ff-only origin main
npm ci
npm run dev
```

Abrir:

```text
http://localhost:3000
```

## Verificação rápida

Antes de alterar código:

```powershell
git status -sb
git rev-parse HEAD
git log -1 --oneline
```

O working tree deve estar limpo antes de iniciar nova alteração.

## Estado funcional já validado

- Login Google/OAuth em produção.
- Upload e processamento documental.
- Alertas contratuais por e-mail.
- Botão VER EVENTO.
- RESOLVIDO em um clique.
- EM ANDAMENTO com o mesmo fluxo de ação rápida.
- ENVIADO P/ com escolha de colaborador.
- RESPONDER AO ACC.
- Construmanager conectado.
- Diário de Obra conectado.
- Diretor de Planejamento com MPP estruturado.
- Integração Gmail passa a `CONECTADO` após sincronização bem-sucedida.

## Regra para continuar

Não desenvolver funcionalidade nova durante o fechamento do piloto. Corrigir somente falhas encontradas no smoke test final.
