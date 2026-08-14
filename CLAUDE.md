# CLAUDE.md — Axion Contract Intelligence

Este arquivo registra regras permanentes de colaboração e a arquitetura do projeto. Deve ser lido antes de qualquer alteração relevante no repositório.

## Regras permanentes

1. Projeto desenvolvido prioritariamente por Vibe Coding.

2. Antes de alterações relevantes:
   - entender a solicitação;
   - analisar o estado atual;
   - verificar Git;
   - avaliar impactos;
   - preservar funcionalidades existentes.

3. Antes de mudanças estruturais importantes, criar checkpoint Git quando apropriado.

4. Após alterações:
   - executar lint;
   - executar build;
   - testar;
   - verificar erros;
   - corrigir;
   - testar novamente.

5. Nunca considerar uma tarefa concluída apenas porque compilou.

6. Nunca expor:
   - passwords;
   - tokens;
   - API keys;
   - secrets;
   - credentials.

7. Nunca colocar secrets no frontend.

8. Arquivos `.env` e equivalentes nunca devem ser versionados.

9. Nunca apagar arquivos, dados, documentos ou evidências importantes sem autorização.

10. Preservar documentos e evidências originais utilizados pelo sistema.

11. Toda informação derivada deverá manter rastreabilidade até sua fonte original.

12. Análises futuras realizadas por IA devem:
    - indicar evidências;
    - permitir revisão humana;
    - não alterar evidências originais;
    - diferenciar fato, inferência e recomendação.

13. Preferir arquitetura simples, modular e expansível.

14. Evitar microserviços e complexidade desnecessária.

15. Não fazer `git push` sem autorização explícita do usuário.

16. Integrações reais devem utilizar configuração segura server-side.

17. Alterações futuras não podem quebrar funcionalidades existentes silenciosamente.

## Arquitetura atual (Fase 1)

- Monorepo (npm workspaces)
- `apps/web` — aplicação principal
- Next.js
- React
- TypeScript
- Tailwind CSS
- shadcn/ui
- `packages/types` — tipos compartilhados
- `packages/mock-data` — dados fictícios para prototipagem

## Arquitetura futura prevista

- PostgreSQL
- Autenticação
- RBAC por projeto
- Google Workspace / Gmail
- Google Drive
- Diário de Obra
- Construmanager
- ERP
- Sistema de Orçamentos
- Cronograma
- Event Ledger
- Inteligência contratual por IA
