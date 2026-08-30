-- ============================================================
-- 20260829090000_document_contractual_attachment_linkage.sql
--
-- Vínculo REAL e persistido entre um documento e o instrumento
-- contratual (contrato-base ou aditivo) ao qual ele foi formalmente
-- incorporado como anexo contratual. Antes desta migration, NENHUMA
-- tabela/coluna representava esse vínculo (confirmado por varredura
-- completa das migrations anteriores) — a interface de Documentos
-- (apps/web/lib/documents/group-contractual-documents.ts) já está
-- preparada para consumir esse dado desde uma rodada anterior, mas
-- `parentDocumentId` era sempre `null` porque não existia onde
-- persistir. Esta migration cria exatamente essa coluna.
--
-- NÃO APLICAR NESTA RODADA. Ver "ORDEM SEGURA DE IMPLANTAÇÃO" no
-- relatório final — a aplicação em produção aponta para um banco sem
-- essas colunas; o código consumidor (Server Actions/UI/pipeline do
-- Expert Jurídico) continua deliberadamente sem fazer nenhuma consulta
-- real às novas colunas até esta migration ser revisada e aplicada.
--
-- Nomenclatura: `contractual_*` (nunca `parent_document_id` sozinho) —
-- deliberado, para nunca ser confundido com uma futura hierarquia
-- documental não contratual (ex.: revisões/traduções de um mesmo
-- documento, ou um agrupamento puramente organizacional). Este vínculo
-- é SEMPRE e SOMENTE sobre incorporação contratual formal.
--
-- Tipos de pai aceitos: o pedido original menciona CONTRATO_BASE,
-- CONTRATO e ADITIVO_CONTRATUAL — mas o enum real de documents.kind
-- (documents_kind_check, migration 20260825130000) só tem
-- CONTRATO_BASE e ADITIVO; não existe 'CONTRATO' nem
-- 'ADITIVO_CONTRATUAL' em nenhum dado real. Em vez de inventar dois
-- valores de kind novos (mudança maior, fora do escopo pedido aqui), o
-- pai é validado contra os DOIS valores que realmente existem e que já
-- são reconhecidos em toda a aplicação como "instrumento contratual"
-- (document-kind-card-appearance.ts, group-contractual-documents.ts):
-- CONTRATO_BASE e ADITIVO.
--
-- SOBRE A GUC acc.contractual_link_rpc: uma custom GUC de sessão/
-- transação (set_config) é coordenação interna, NUNCA um segredo à
-- prova de quem já tem acesso SQL suficiente para rodar
-- `SET acc.contractual_link_rpc = 'true'` antes de um UPDATE manual. A
-- autorização REAL continua sendo, nesta ordem: (1) RLS de documents
-- (nenhuma policy de INSERT/UPDATE/DELETE existe — só SELECT, migration
-- 20260818195206 — então authenticated/anon via PostgREST são
-- barrados antes de qualquer trigger rodar); (2) a ausência de GRANT
-- direto de UPDATE a authenticated/anon na tabela; (3)
-- can_manage_project_documents(), chamada dentro das RPCs. A GUC só
-- evita que uma OUTRA function SECURITY DEFINER futura, escrita sem
-- essa checagem, escreva sem validação — e mesmo com a GUC setada, a
-- function abaixo sempre roda a validação estrutural completa (ciclo,
-- tipo do pai, mesmo projeto, comprimento do fundamento,
-- contractual_linked_by_user_id = auth.uid()) — nunca "confia" na GUC
-- para pular essa validação.
--
-- SOBRE SECURITY DEFINER: das 6 functions desta migration, CINCO são
-- SECURITY DEFINER — documents_contractual_link_would_cycle,
-- documents_validate_contractual_link,
-- documents_protect_contractual_link_integrity,
-- link_document_as_contractual_attachment,
-- unlink_document_contractual_attachment — e rodam com os privilégios
-- do DONO da function (postgres, explícito e determinístico via
-- `alter function ... owner to postgres` logo após cada `create or
-- replace function` dessas 5 — as 4 auxiliares ganharam isso nesta
-- revisão — antes dependiam implicitamente de "quem executa a
-- migration", nunca mais). `postgres` é a role confirmada por consulta
-- read-only a pg_proc antes de escrever a migration histórica de
-- referência desta convenção (register_project_document_upload,
-- migration 20260825130000, comentário "Privilégios: restaura
-- exatamente o estado hoje em produção") — mesma convenção seguida
-- aqui, nunca presumida sem essa verificação anterior já registrada no
-- histórico deste repositório. NUNCA com os privilégios de quem
-- estiver conectado como client (`authenticated`/`anon`) — essa é
-- justamente a razão de existir SECURITY DEFINER nelas: sem isso,
-- rodariam como o role do chamador, que não tem GRANT de escrita em
-- `documents` (só SELECT via RLS).
--
-- A SEXTA — normalize_contractual_text (seção 1) — é DELIBERADAMENTE
-- INVOKER (comportamento padrão do Postgres quando SECURITY DEFINER
-- não é declarado; não confundir com as outras 5). Correto e
-- preferível aqui: é uma function PURA (só transforma o texto de
-- entrada, IMMUTABLE, sem tocar em nenhuma tabela) — não há nenhum
-- motivo de segurança para elevar privilégio numa function pura, e
-- fazer isso à toa seria expandir a superfície SECURITY DEFINER sem
-- necessidade. Ela continua funcionando corretamente dentro das 3
-- chamadas procedurais (2 RPCs + 1 trigger) porque, sendo INVOKER, ela
-- roda com os privilégios de QUEM A CHAMA no momento da chamada — e
-- quem a chama são sempre essas 3 functions SECURITY DEFINER, cujo
-- "quem chama" já foi elevado a postgres antes de qualquer instrução
-- do corpo delas rodar (SECURITY DEFINER troca o role efetivo para
-- toda a duração da execução da function, não só para as instruções
-- diretas do seu corpo) — então o chamador EFETIVO de
-- normalize_contractual_text(), nesses 3 pontos, sempre é postgres, o
-- dono, mesmo sem SECURITY DEFINER na normalizadora. `owner to
-- postgres` nela é só para manter o owner determinístico/documentado
-- (não presumir "quem rodou a migration"), não para mudar semântica de
-- privilégio de execução (que já é INVOKER por padrão).
--
-- `auth.uid()` continua refletindo corretamente a identidade do
-- usuário autenticado da requisição em qualquer uma das 5 functions
-- SECURITY DEFINER — é lido de uma claim do JWT da sessão (via
-- auth.jwt()/current_setting interno do Supabase Auth), não do role
-- Postgres em uso — por isso a comparação
-- `contractual_linked_by_user_id = auth.uid()` (seção 4) continua
-- válida mesmo com a function rodando como postgres.
--
-- SOBRE CONCORRÊNCIA: ver seção 4 (trigger de validação) e seção 6
-- (RPC de vínculo) — a leitura do documento PAI usa `FOR SHARE`, nunca
-- um SELECT solto. Isso permite múltiplos vínculos simultâneos ao
-- mesmo pai (FOR SHARE é compatível com FOR SHARE de outras
-- transações), mas bloqueia qualquer UPDATE concorrente de kind/
-- project_id desse pai até a transação do vínculo terminar — e,
-- simetricamente, uma alteração de kind/project_id em andamento (que
-- já detém o lock implícito de UPDATE na linha do pai) faz uma
-- tentativa concorrente de vínculo esperar essa alteração terminar
-- antes de reler o estado atual do pai. Prova determinística (não
-- roteiro manual) em scripts/sql/run-contractual-link-concurrency-test.mjs
-- (chama as RPCs REAIS com um usuário autenticado real, confirma
-- bloqueio de verdade via pg_stat_activity, cobre COMMIT e ROLLBACK
-- para kind E project_id, nos dois ordenamentos — NÃO EXECUTADO nesta
-- rodada, requer um Postgres real descartável com esta migration
-- aplicada, ver relatório).
-- ============================================================


-- ============================================================
-- 1. NORMALIZAÇÃO DE WHITESPACE — função IMMUTABLE reutilizada pela
--    RPC de vínculo (seção 6), pelo trigger de validação (seção 4) e
--    pela RPC de desvinculação (seção 6) — MESMA regra nos três
--    lugares PROCEDURAIS. A CHECK constraint do fundamento (seção 2)
--    NÃO chama esta function — usa a MESMA expressão regex inlinada
--    diretamente — ver o porquê no comentário dessa CHECK.
--
--    trim() do Postgres só remove espaço comum (' ') das extremidades
--    — um texto como "\t\t\t...\n" (só tabs/quebras de linha) passaria
--    por `nullif(trim(x), '')` sem ser considerado vazio. A função
--    abaixo remove QUALQUER whitespace (space, tab, newline, CR, form
--    feed — classe \s do motor de regex do Postgres) das duas pontas,
--    e devolve NULL quando o resultado fica vazio (nunca uma string
--    vazia solta, que poderia escapar de uma checagem "is null").
--
--    ESTA FUNCTION (normalize_contractual_text) É INVOKER, não
--    SECURITY DEFINER — deliberado (function pura, ver "SOBRE SECURITY
--    DEFINER" no topo desta migration para o porquê). Isso NÃO é um
--    problema para as 3 chamadas procedurais que a usam (RPC de
--    vínculo, trigger de validação, RPC de desvinculação): sendo
--    INVOKER, ela roda com os privilégios de quem a chama no momento
--    da chamada — e as 3 chamadoras são SECURITY DEFINER, já rodando
--    como postgres (o dono) quando chegam nessa chamada. EXECUTE
--    revogado de public/anon/authenticated mesmo assim (defesa em
--    profundidade explícita — o dono sempre pode executar sua própria
--    function independentemente de REVOKE, então isto não muda nada
--    para os 3 usos legítimos, só fecha qualquer outro uso).
--
--    NUNCA usada dentro de uma CHECK constraint (só builtins ali, ver
--    seção 2) — CHECK constraints são avaliadas com os privilégios de
--    QUALQUER role que estiver fazendo o INSERT/UPDATE na tabela, não
--    necessariamente postgres; uma role sem EXECUTE nesta function
--    receberia "permission denied for function
--    normalize_contractual_text" se a CHECK a chamasse. Verificado:
--    hoje só RPCs SECURITY DEFINER (owner postgres) escrevem em
--    documents — MAS existe pelo menos um caminho de escrita direta
--    fora de RPC já no código-fonte
--    (apps/web/lib/email/attachments/link-email-attachment-to-document.ts,
--    `.from("documents").insert(...)` — hoje sem nenhum caller real,
--    mas existe) — por isso a CHECK nunca depende desta function.
-- ============================================================

create or replace function public.normalize_contractual_text(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(regexp_replace(p_value, '^\s+|\s+$', '', 'g'), '');
$$;

alter function public.normalize_contractual_text(text) owner to postgres;
revoke execute on function public.normalize_contractual_text(text) from public;
revoke execute on function public.normalize_contractual_text(text) from anon;
revoke execute on function public.normalize_contractual_text(text) from authenticated;
-- Só uso interno (RPCs/trigger desta migration) — nunca uma RPC
-- própria, nunca chamada de dentro de uma CHECK constraint.


-- ============================================================
-- 2. COLUNAS EM documents (vínculo no nível de documents, nunca de
--    document_versions — o vínculo contratual é do DOCUMENTO como um
--    todo, não de uma versão específica de arquivo)
-- ============================================================

alter table public.documents
  add column contractual_parent_document_id uuid
    references public.documents (id) on delete restrict,
  add column contractual_incorporation_basis text,
  add column contractual_linked_by_user_id uuid
    references public.profiles (id) on delete restrict,
  add column contractual_linked_at timestamptz;

create index documents_contractual_parent_document_id_idx
  on public.documents (contractual_parent_document_id);

-- Autorreferência direta (pai = o próprio documento) — checada aqui a
-- nível de coluna, sem precisar de query; ciclos indiretos (A -> B ->
-- A) exigem a função recursiva da seção 3, não expressável em CHECK.
alter table public.documents
  add constraint documents_contractual_parent_not_self_check
  check (contractual_parent_document_id is distinct from id);

-- Os quatro metadados do vínculo são preenchidos/limpos SEMPRE juntos
-- — nunca um fundamento órfão sem pai, nunca um pai sem quem/quando
-- vinculou. O trigger da seção 4 é quem efetivamente impõe isso (limpa
-- os três ao desvincular, exige os três ao vincular); esta CHECK é uma
-- segunda camada, redundante por construção — inclusive protege contra
-- uma escrita privilegiada que rode com triggers desabilitados
-- (`ALTER TABLE ... DISABLE TRIGGER`), já que CHECK constraints são
-- sempre avaliadas pelo Postgres independentemente de trigger.
alter table public.documents
  add constraint documents_contractual_link_metadata_consistency_check
  check (
    (
      contractual_parent_document_id is null
      and contractual_incorporation_basis is null
      and contractual_linked_by_user_id is null
      and contractual_linked_at is null
    )
    or (
      contractual_parent_document_id is not null
      and contractual_incorporation_basis is not null
      and contractual_linked_by_user_id is not null
      and contractual_linked_at is not null
    )
  );

-- Comprimento do fundamento — CHECK, não só validação em RPC/trigger:
-- protege TAMBÉM uma escrita privilegiada fora da RPC (com triggers
-- desabilitados) contra um fundamento vazio/curto demais (inclusive só
-- whitespace) ou anormalmente grande (abuso, crescimento desnecessário
-- da auditoria). Mínimo 20 caracteres ÚTEIS (após normalizar), máximo
-- 2000 (comprimento bruto).
--
-- DELIBERADAMENTE NÃO chama public.normalize_contractual_text() — usa
-- a MESMA expressão regex (`regexp_replace(x, '^\s+|\s+$', '', 'g')`)
-- INLINADA diretamente aqui. Motivo: uma CHECK constraint é avaliada
-- com os privilégios de QUALQUER role que estiver fazendo o
-- INSERT/UPDATE em documents — não necessariamente o dono da function
-- (diferente das RPCs/trigger, que são SECURITY DEFINER e sempre
-- rodam como o dono). Se a CHECK chamasse a function (que teve EXECUTE
-- revogado de public/anon/authenticated na seção 1), uma escrita
-- direta em documents por qualquer role sem GRANT EXECUTE explícito
-- nessa function — incluindo um cliente service_role hipotético, ou o
-- caminho `.from("documents").insert(...)` já existente em
-- apps/web/lib/email/attachments/link-email-attachment-to-document.ts
-- (hoje sem caller, mas presente no código) — receberia "permission
-- denied for function normalize_contractual_text" em vez do erro de
-- validação pretendido, ou pior, quebraria um upload legítimo comum.
-- Usar só builtins (regexp_replace/nullif/length, sempre executáveis
-- por qualquer role, nunca sujeitos a REVOKE nesta migration) elimina
-- essa dependência de permissão por completo.
--
-- Nota sobre NULL em CHECK constraints: uma expressão que avalia NULL
-- (nunca FALSE) é ACEITA pelo Postgres — por isso a checagem usa
-- "... IS NOT NULL" explicitamente (um booleano sempre determinado) em
-- vez de só "length(...) >= 20" sozinho (que avaliaria NULL, não
-- FALSE, para uma entrada só-whitespace, e a constraint aceitaria
-- incorretamente a linha).
alter table public.documents
  add constraint documents_contractual_incorporation_basis_length_check
  check (
    contractual_incorporation_basis is null
    or (
      nullif(regexp_replace(contractual_incorporation_basis, '^\s+|\s+$', '', 'g'), '') is not null
      and length(nullif(regexp_replace(contractual_incorporation_basis, '^\s+|\s+$', '', 'g'), '')) >= 20
      and length(contractual_incorporation_basis) <= 2000
    )
  );

-- Contrato-base/aditivo são SEMPRE documentos principais — nunca
-- podem, eles próprios, ser anexo de outro documento. CHECK (não só
-- trigger): protege escrita privilegiada com triggers desabilitados.
alter table public.documents
  add constraint documents_contractual_instrument_never_child_check
  check (
    contractual_parent_document_id is null
    or kind not in ('CONTRATO_BASE', 'ADITIVO')
  );

-- Nota sobre ON DELETE CASCADE de projects -> documents (migration
-- 20260818195206): excluir um projeto inteiro remove, numa única
-- operação em cascata, TODOS os seus documentos — pai e filhos
-- contratuais juntos. Constraints de chave estrangeira NOT DEFERRABLE
-- (o padrão, usado aqui) são checadas ao final do statement, não por
-- linha — então um pai e seu(s) filho(s) desaparecendo juntos na MESMA
-- cascata nunca viola o ON DELETE RESTRICT entre eles. Nenhum
-- tratamento especial é necessário para esse caminho (ver plano de
-- validação no relatório para o teste real dessa interação).


-- ============================================================
-- 3. Detecção de ciclo — função read-only reutilizada pelo trigger de
--    validação (seção 4). Percorre a cadeia de pais a partir de
--    p_starting_parent_id; se em algum ponto encontrar
--    p_child_document_id, existe um ciclo. Profundidade limitada a 50
--    (fail-closed: acima disso, trata como ciclo em vez de continuar
--    percorrendo indefinidamente — defensivo contra estado corrompido
--    pré-existente; nenhum vínculo criado só pelas RPCs desta migration
--    chegaria perto disso, já que a própria validação de tipo do pai
--    mantém a cadeia extremamente rasa na prática).
-- ============================================================

create or replace function public.documents_contractual_link_would_cycle(
  p_child_document_id uuid,
  p_starting_parent_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_current_id uuid := p_starting_parent_id;
  v_next_parent_id uuid;
  v_depth integer := 0;
begin
  loop
    if v_current_id = p_child_document_id then
      return true;
    end if;

    v_depth := v_depth + 1;
    if v_depth > 50 then
      -- Fail-closed: nunca deixa passar silenciosamente.
      return true;
    end if;

    select contractual_parent_document_id
    into v_next_parent_id
    from public.documents
    where id = v_current_id;

    if v_next_parent_id is null then
      return false;
    end if;

    v_current_id := v_next_parent_id;
  end loop;
end;
$$;

alter function public.documents_contractual_link_would_cycle(uuid, uuid) owner to postgres;
revoke execute on function public.documents_contractual_link_would_cycle(uuid, uuid) from public;
revoke execute on function public.documents_contractual_link_would_cycle(uuid, uuid) from anon;
revoke execute on function public.documents_contractual_link_would_cycle(uuid, uuid) from authenticated;
-- Nunca chamada como RPC por nenhum client — só internamente, dentro
-- do trigger da seção 4, que roda SECURITY DEFINER (privilégios do
-- dono da function, nunca do role do chamador — ver nota no topo desta
-- migration). Não precisa de GRANT EXECUTE para uso interno.


-- ============================================================
-- 4. Trigger de VALIDAÇÃO do vínculo — observa as QUATRO colunas de
--    metadado (não só contractual_parent_document_id): uma alteração
--    isolada de contractual_incorporation_basis/
--    contractual_linked_by_user_id/contractual_linked_at, sem tocar em
--    contractual_parent_document_id, também dispara a validação
--    completa — fecha o bypass em que só o pai era observado.
--
--    CONCORRÊNCIA: a leitura do documento PAI usa FOR SHARE (nunca um
--    SELECT solto) — ver nota "SOBRE CONCORRÊNCIA" no topo da
--    migration. Isto é redundante, de propósito, com o FOR SHARE já
--    feito dentro da RPC de vínculo (seção 6): o mesmo lock, pedido
--    duas vezes na MESMA transação, é um no-op para o Postgres — nunca
--    um deadlock consigo mesma — e garante que o trigger NUNCA confia
--    cegamente numa leitura feita antes dele (ex.: por uma function
--    SECURITY DEFINER futura que esqueça de lockar o pai).
-- ============================================================

create or replace function public.documents_validate_contractual_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent_project_id uuid;
  v_parent_kind text;
  v_normalized_basis text;
begin

  -- Nada nos 4 metadados de vínculo mudou (INSERT com os 4 no default
  -- NULL, ou UPDATE em que os 4 continuam idênticos a OLD) — sai cedo.
  -- A imensa maioria dos INSERTs/UPDATEs em documents (upload de
  -- documento, nova versão etc.) nunca toca nenhuma destas 4 colunas.
  if tg_op = 'INSERT'
     and new.contractual_parent_document_id is null
     and new.contractual_incorporation_basis is null
     and new.contractual_linked_by_user_id is null
     and new.contractual_linked_at is null
  then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.contractual_parent_document_id is not distinct from old.contractual_parent_document_id
     and new.contractual_incorporation_basis is not distinct from old.contractual_incorporation_basis
     and new.contractual_linked_by_user_id is not distinct from old.contractual_linked_by_user_id
     and new.contractual_linked_at is not distinct from old.contractual_linked_at
  then
    return new;
  end if;

  -- A partir daqui, PELO MENOS UM dos 4 metadados está mudando. A GUC
  -- abaixo é só coordenação interna (ver nota no topo desta migration
  -- — nunca a autorização real, nunca "à prova" de quem já tem acesso
  -- SQL suficiente para forjá-la). Mesmo com ela setada, TODA a
  -- validação estrutural abaixo roda sempre, sem exceção.
  if coalesce(current_setting('acc.contractual_link_rpc', true), '') <> 'true' then
    raise exception
      'contractual_parent_document_id/contractual_incorporation_basis/contractual_linked_by_user_id/contractual_linked_at só podem ser alterados por link_document_as_contractual_attachment/unlink_document_contractual_attachment';
  end if;

  if new.contractual_parent_document_id is null then
    -- Desvinculação: os 4 metadados têm que ficar null JUNTOS — nunca
    -- deixa um fundamento/usuário/data órfão para trás.
    if new.contractual_incorporation_basis is not null
       or new.contractual_linked_by_user_id is not null
       or new.contractual_linked_at is not null then
      raise exception 'Ao desvincular, os 4 metadados do vínculo devem ser limpos juntos';
    end if;
    return new;
  end if;

  -- Vinculando (inclusive reafirmar/trocar um vínculo existente).

  if new.contractual_parent_document_id = new.id then
    raise exception 'Documento não pode ser pai de si mesmo';
  end if;

  if new.kind in ('CONTRATO_BASE', 'ADITIVO') then
    -- Reforça, com mensagem amigável, a CHECK constraint
    -- documents_contractual_instrument_never_child_check (seção 2) —
    -- contrato-base/aditivo nunca são anexo de outro documento.
    raise exception 'Contrato-base e aditivo nunca podem ser anexo de outro documento';
  end if;

  -- FOR SHARE: bloqueia (espera) qualquer UPDATE concorrente de
  -- kind/project_id neste pai até esta transação terminar, e é
  -- compatível com FOR SHARE de outras transações vinculando outros
  -- filhos ao MESMO pai simultaneamente. Ver nota "SOBRE CONCORRÊNCIA"
  -- no topo da migration.
  select d.project_id, d.kind
  into v_parent_project_id, v_parent_kind
  from public.documents d
  where d.id = new.contractual_parent_document_id
  for share;

  if not found then
    raise exception 'Documento pai não encontrado';
  end if;

  if v_parent_project_id is distinct from new.project_id then
    raise exception 'Documento pai pertence a outro projeto';
  end if;

  -- Fail-closed explícito: rejeita tanto um tipo inválido quanto
  -- v_parent_kind NULL — nunca depende implicitamente de
  -- documents.kind ser NOT NULL hoje (mesmo que seja); um NULL aqui
  -- (por qualquer razão futura) tem que ser tratado como inválido, não
  -- como "passa sem verificar" (lembrete: `NULL NOT IN (...)` avalia
  -- NULL, não TRUE, então sem o "IS NULL" explícito abaixo um
  -- v_parent_kind nulo silenciosamente pularia esta rejeição).
  if v_parent_kind is null or v_parent_kind not in ('CONTRATO_BASE', 'ADITIVO') then
    raise exception 'Documento pai precisa ser do tipo CONTRATO_BASE ou ADITIVO';
  end if;

  if public.documents_contractual_link_would_cycle(new.id, new.contractual_parent_document_id) then
    raise exception 'Vínculo recusado: geraria um ciclo entre documentos';
  end if;

  -- contractual_linked_by_user_id tem que ser o usuário autenticado da
  -- PRÓPRIA transação — nunca um id arbitrário passado por quem
  -- escreve (mesmo com a GUC setada). auth.uid() é null fora de uma
  -- sessão autenticada (ex.: uma migration futura rodada como
  -- superusuário) — nesse caso a comparação abaixo já falha, o que é
  -- o comportamento correto (fail-closed).
  if new.contractual_linked_by_user_id is distinct from auth.uid() then
    raise exception 'contractual_linked_by_user_id deve ser exatamente o usuário autenticado (auth.uid()) da transação que está escrevendo';
  end if;

  if new.contractual_linked_at is null then
    raise exception 'Data do vínculo é obrigatória';
  end if;

  -- Comprimento do fundamento (após normalizar QUALQUER whitespace nas
  -- pontas — ver normalize_contractual_text, seção 1 — não só espaço
  -- comum) — mensagem amigável antes da CHECK constraint
  -- (documents_contractual_incorporation_basis_length_check, seção 2)
  -- rejeitar com um erro genérico de Postgres; a CHECK continua sendo
  -- a garantia real (roda mesmo se este trigger for desabilitado).
  v_normalized_basis := public.normalize_contractual_text(new.contractual_incorporation_basis);
  if v_normalized_basis is null or length(v_normalized_basis) < 20 then
    raise exception 'Fundamento da incorporação deve ter pelo menos 20 caracteres úteis (espaços/tabs/quebras de linha nas pontas não contam)';
  end if;
  if length(new.contractual_incorporation_basis) > 2000 then
    raise exception 'Fundamento da incorporação não pode passar de 2000 caracteres';
  end if;
  new.contractual_incorporation_basis := v_normalized_basis;

  return new;
end;
$$;

create trigger documents_validate_contractual_link_trigger
before insert or update of
  contractual_parent_document_id,
  contractual_incorporation_basis,
  contractual_linked_by_user_id,
  contractual_linked_at
on public.documents
for each row
execute function public.documents_validate_contractual_link();

alter function public.documents_validate_contractual_link() owner to postgres;
revoke execute on function public.documents_validate_contractual_link() from public;
revoke execute on function public.documents_validate_contractual_link() from anon;
revoke execute on function public.documents_validate_contractual_link() from authenticated;
-- Uma trigger function (retorna "trigger") não pode ser chamada como
-- RPC/SELECT comum de qualquer forma — o Postgres recusa isso com
-- "trigger functions can only be called as triggers". O REVOKE aqui é
-- defesa em profundidade explícita, não uma proteção que faltava.


-- ============================================================
-- 5. Trigger de INTEGRIDADE ESTRUTURAL — protege kind/project_id de
--    QUALQUER documento que participe de um vínculo contratual (como
--    pai ou como filho), independente de quem faz a alteração (nunca
--    gated pela GUC — isto não é "quem pode vincular", é uma garantia
--    de consistência dos dados que precisa valer sempre, para todo
--    mundo, inclusive as duas RPCs desta migration, que nunca tocam
--    kind/project_id de qualquer forma). Não bloqueia nenhuma
--    alteração legítima em documentos SEM vínculo (a maioria).
--
--    CONCORRÊNCIA: esta function roda DEPOIS que a transação atual já
--    adquiriu o lock implícito de UPDATE na própria linha do pai (é
--    esse UPDATE que a disparou) — esse lock já é incompatível com o
--    FOR SHARE que a seção 4/6 pedem, então qualquer vínculo
--    concorrente tentando ler este mesmo pai fica bloqueado até esta
--    transação terminar (commit ou rollback), sem precisar de nenhum
--    lock adicional aqui. Ver nota "SOBRE CONCORRÊNCIA" no topo da
--    migration.
-- ============================================================

create or replace function public.documents_protect_contractual_link_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_has_children boolean;
begin

  if new.kind is not distinct from old.kind
     and new.project_id is not distinct from old.project_id then
    return new;
  end if;

  -- Este documento é pai de algum anexo contratual?
  select exists (
    select 1
    from public.documents
    where contractual_parent_document_id = old.id
  )
  into v_has_children;

  if v_has_children then
    if new.kind is distinct from old.kind then
      raise exception
        'Documento não pode mudar de tipo: é pai de anexo(s) contratual(is) vinculado(s) (contrato-base/aditivo precisam continuar CONTRATO_BASE/ADITIVO enquanto tiverem anexos)';
    end if;

    if new.project_id is distinct from old.project_id then
      raise exception
        'Documento não pode mudar de projeto: é pai de anexo(s) contratual(is) vinculado(s) neste projeto';
    end if;
  end if;

  -- Este documento é, ele próprio, um anexo vinculado a um pai?
  if old.contractual_parent_document_id is not null
     and new.project_id is distinct from old.project_id then
    raise exception
      'Documento vinculado como anexo contratual não pode mudar de projeto — isso produziria um vínculo entre projetos diferentes';
  end if;

  return new;
end;
$$;

create trigger documents_protect_contractual_link_integrity_trigger
before update of kind, project_id on public.documents
for each row
execute function public.documents_protect_contractual_link_integrity();

alter function public.documents_protect_contractual_link_integrity() owner to postgres;
revoke execute on function public.documents_protect_contractual_link_integrity() from public;
revoke execute on function public.documents_protect_contractual_link_integrity() from anon;
revoke execute on function public.documents_protect_contractual_link_integrity() from authenticated;


-- ============================================================
-- 6. RPCs — únicos pontos de entrada para vincular/desvincular
--
--    CONCORRÊNCIA OTIMISTA (link): p_expected_parent_document_id
--    exige que o caller declare qual pai ele ACHA que o documento tem
--    agora (ou NULL, se ele acha que não há vínculo) — depois de
--    lockar e reler o filho de verdade, a RPC recusa
--    (CONFLICT_STALE_PARENT) se o valor real for diferente do
--    esperado, em vez de silenciosamente sobrescrever um vínculo que
--    outra sessão criou/mudou nesse meio-tempo. Trocar de um pai já
--    existente para outro pai (não apenas reafirmar/atualizar o
--    fundamento do MESMO pai) exige também p_confirm_parent_change =
--    true — validado aqui dentro, nunca só por um checkbox no
--    navegador.
-- ============================================================

create or replace function public.link_document_as_contractual_attachment(
  p_project_id uuid,
  p_child_document_id uuid,
  p_parent_document_id uuid,
  p_incorporation_basis text,
  p_expected_parent_document_id uuid,
  p_confirm_parent_change boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_child_project_id uuid;
  v_previous_parent_id uuid;
  v_previous_basis text;
  v_previous_linked_by uuid;
  v_previous_linked_at timestamptz;
  v_parent_kind text;
  v_parent_label text;
  v_child_title text;
  v_basis text;
begin

  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  -- Reaproveita a MESMA permissão canônica de gestão documental já
  -- usada por register_project_document_upload/
  -- promote_email_attachment_to_document (migration 20260825130000) —
  -- nenhuma regra paralela criada aqui.
  if not public.can_manage_project_documents(p_project_id) then
    raise exception 'ADMINISTRADOR or GESTOR permission required';
  end if;

  if p_project_id is null or p_child_document_id is null or p_parent_document_id is null then
    raise exception 'Invalid identifiers';
  end if;

  -- Normaliza QUALQUER whitespace nas pontas (não só espaço comum —
  -- ver normalize_contractual_text, seção 1). v_basis já sai NULL se o
  -- texto for só whitespace.
  v_basis := public.normalize_contractual_text(p_incorporation_basis);
  if v_basis is null or length(v_basis) < 20 then
    raise exception 'Fundamento da incorporação deve ter pelo menos 20 caracteres úteis (espaços/tabs/quebras de linha nas pontas não contam)';
  end if;
  if length(p_incorporation_basis) > 2000 then
    raise exception 'Fundamento da incorporação não pode passar de 2000 caracteres';
  end if;

  -- Resolve TUDO de novo no banco a partir só dos ids — nunca confia
  -- em projeto/tipo/nome vindos do navegador (o dropdown do cliente
  -- poderia ter sido adulterado no DOM antes do submit). Captura os
  -- valores ANTERIORES dos 4 metadados para a auditoria completa e
  -- para a checagem de concorrência otimista abaixo.
  select
    project_id,
    title,
    contractual_parent_document_id,
    contractual_incorporation_basis,
    contractual_linked_by_user_id,
    contractual_linked_at
  into
    v_child_project_id,
    v_child_title,
    v_previous_parent_id,
    v_previous_basis,
    v_previous_linked_by,
    v_previous_linked_at
  from public.documents
  where id = p_child_document_id
  for update;

  if not found then
    raise exception 'Documento filho não encontrado';
  end if;

  if v_child_project_id is distinct from p_project_id then
    raise exception 'Documento filho pertence a outro projeto';
  end if;

  -- CONCORRÊNCIA OTIMISTA: o pai atual (já lido acima, sob FOR UPDATE
  -- do próprio filho) precisa bater com o que o caller diz esperar —
  -- senão, a tela do caller está desatualizada (outra sessão já
  -- vinculou/trocou/desvinculou este documento nesse meio-tempo).
  if v_previous_parent_id is distinct from p_expected_parent_document_id then
    raise exception 'CONFLICT_STALE_PARENT: o vínculo atual deste documento mudou desde que a página foi carregada — recarregue e tente novamente.';
  end if;

  -- Trocar de um pai já existente para um pai DIFERENTE exige
  -- confirmação explícita — atualizar só o fundamento do MESMO pai
  -- (p_parent_document_id = v_previous_parent_id) nunca exige isso.
  --
  -- "p_confirm_parent_change IS NOT TRUE" — NUNCA "not p_confirm_parent_change".
  -- Em SQL/PL-pgSQL, `not NULL` avalia NULL (não TRUE) — se o caller
  -- (ou uma chamada direta à RPC ignorando o formulário) omitisse o
  -- parâmetro ou enviasse NULL explicitamente, `not p_confirm_parent_change`
  -- seria NULL, o `IF` inteiro (que depende de AND com esse NULL)
  -- avaliaria NULL, e o bloco de exceção NUNCA seria executado — uma
  -- troca de pai passaria sem confirmação nenhuma. `IS NOT TRUE` é
  -- sempre um booleano determinado (TRUE para FALSE ou NULL, FALSE só
  -- para TRUE) — fail-closed também aqui.
  if v_previous_parent_id is not null
     and v_previous_parent_id is distinct from p_parent_document_id
     and p_confirm_parent_change is not true then
    raise exception 'CONFIRMATION_REQUIRED: já existe um vínculo com outro documento pai — confirme a troca explicitamente.';
  end if;

  -- FOR SHARE no pai: permite vários vínculos simultâneos ao mesmo
  -- pai, mas bloqueia (espera) qualquer UPDATE concorrente de
  -- kind/project_id nele — e, se uma alteração dessas já estiver em
  -- andamento (segurando o lock de UPDATE na linha do pai), este
  -- SELECT espera ela terminar e relê o estado JÁ ATUALIZADO antes de
  -- decidir. Ver nota "SOBRE CONCORRÊNCIA" no topo da migration.
  select d.kind
  into v_parent_kind
  from public.documents d
  where d.id = p_parent_document_id
    and d.project_id = p_project_id
    and d.kind in ('CONTRATO_BASE', 'ADITIVO')
  for share;

  if v_parent_kind is null then
    -- Mensagem intencionalmente genérica (não distingue "não existe" de
    -- "existe mas é do tipo/projeto errado", nem "existia mas deixou de
    -- ser válido enquanto esta transação esperava o lock") — nunca vaza
    -- para o cliente detalhes sobre um documento de outro projeto.
    raise exception 'Documento pai inválido para este projeto';
  end if;

  v_parent_label := case when v_parent_kind = 'CONTRATO_BASE' then 'Contrato-base' else 'Aditivo' end;

  -- A GUC é só coordenação interna com o trigger da seção 4 — a
  -- validação estrutural completa (ciclo, tipo do pai, mesmo projeto,
  -- comprimento do fundamento, contractual_linked_by_user_id =
  -- auth.uid(), inclusive o FOR SHARE de novo no pai) roda de novo lá
  -- dentro, sempre, mesmo com a GUC setada (ver nota no topo desta
  -- migration).
  perform set_config('acc.contractual_link_rpc', 'true', true);

  update public.documents
  set contractual_parent_document_id = p_parent_document_id,
      contractual_incorporation_basis = v_basis,
      contractual_linked_by_user_id = v_user_id,
      contractual_linked_at = now()
  where id = p_child_document_id;

  -- Auditoria — MESMA transação do UPDATE acima: se este INSERT falhar
  -- (ex.: violação de constraint em audit_log_entries), a exceção
  -- propaga e o Postgres desfaz TUDO desde o início da function,
  -- inclusive o UPDATE em documents — nunca um vínculo "órfão" sem
  -- registro de auditoria. Nenhum COMMIT/savepoint intermediário existe
  -- nesta function (garantia por ausência de código, não por comentário).
  insert into public.audit_log_entries (
    project_id,
    actor_type,
    actor_user_id,
    actor_label,
    action,
    entity_type,
    entity_id,
    detail
  )
  values (
    p_project_id,
    'USER',
    v_user_id,
    null,
    'DOCUMENT_CONTRACTUAL_ATTACHMENT_LINKED',
    'DOCUMENT',
    p_child_document_id::text,
    format(
      'Vínculo contratual %s. Documento: "%s" (%s). Pai anterior: %s. Pai novo: %s — %s (%s). Fundamento anterior: %s. Fundamento novo: %s. Usuário anterior do vínculo: %s. Usuário novo do vínculo: %s. Data anterior do vínculo: %s. Data nova do vínculo: %s. Ator desta ação: %s. Momento desta ação: %s.',
      case when v_previous_parent_id is null then 'criado' else 'atualizado' end,
      coalesce(v_child_title, p_child_document_id::text),
      p_child_document_id::text,
      coalesce(v_previous_parent_id::text, '(nenhum)'),
      p_parent_document_id::text,
      v_parent_label,
      v_parent_kind,
      coalesce(v_previous_basis, '(nenhum)'),
      v_basis,
      coalesce(v_previous_linked_by::text, '(nenhum)'),
      v_user_id::text,
      coalesce(v_previous_linked_at::text, '(nenhuma)'),
      now()::text,
      v_user_id::text,
      now()::text
    )
  );

end;
$$;

alter function public.link_document_as_contractual_attachment(uuid, uuid, uuid, text, uuid, boolean) owner to postgres;
revoke execute on function public.link_document_as_contractual_attachment(uuid, uuid, uuid, text, uuid, boolean) from public;
revoke execute on function public.link_document_as_contractual_attachment(uuid, uuid, uuid, text, uuid, boolean) from anon;
grant execute on function public.link_document_as_contractual_attachment(uuid, uuid, uuid, text, uuid, boolean) to authenticated;
-- SEM grant a service_role: esta RPC exige auth.uid() (raise exception
-- quando null) — uma chamada com a chave de service role não tem
-- usuário autenticado, então esse grant seria incoerente (nunca
-- utilizável de verdade) e foi removido. Nenhum caller de service role
-- real e testado existe para esta RPC — se um caso legítimo surgir no
-- futuro, ele precisa ser desenhado (provavelmente exigindo um
-- p_actor_user_id explícito e auditável) e testado antes de conceder
-- o grant, nunca concedido "por via das dúvidas".


create or replace function public.unlink_document_contractual_attachment(
  p_project_id uuid,
  p_child_document_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_child_project_id uuid;
  v_previous_parent_id uuid;
  v_previous_basis text;
  v_previous_linked_by uuid;
  v_previous_linked_at timestamptz;
  v_child_title text;
  v_reason text;
begin

  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not public.can_manage_project_documents(p_project_id) then
    raise exception 'ADMINISTRADOR or GESTOR permission required';
  end if;

  if p_project_id is null or p_child_document_id is null then
    raise exception 'Invalid identifiers';
  end if;

  -- Mesma normalização de whitespace de v_basis acima (seção 1) —
  -- p_reason não é uma coluna persistida (só entra no texto da
  -- auditoria), então não tem CHECK constraint própria; a garantia
  -- aqui é só esta validação em código.
  v_reason := public.normalize_contractual_text(p_reason);
  if v_reason is null or length(v_reason) < 20 then
    raise exception 'Justificativa da desvinculação deve ter pelo menos 20 caracteres úteis (espaços/tabs/quebras de linha nas pontas não contam)';
  end if;
  if length(p_reason) > 2000 then
    raise exception 'Justificativa da desvinculação não pode passar de 2000 caracteres';
  end if;

  select
    project_id,
    title,
    contractual_parent_document_id,
    contractual_incorporation_basis,
    contractual_linked_by_user_id,
    contractual_linked_at
  into
    v_child_project_id,
    v_child_title,
    v_previous_parent_id,
    v_previous_basis,
    v_previous_linked_by,
    v_previous_linked_at
  from public.documents
  where id = p_child_document_id
  for update;

  if not found then
    raise exception 'Documento não encontrado';
  end if;

  if v_child_project_id is distinct from p_project_id then
    raise exception 'Documento pertence a outro projeto';
  end if;

  if v_previous_parent_id is null then
    raise exception 'Documento não tem vínculo contratual ativo';
  end if;

  perform set_config('acc.contractual_link_rpc', 'true', true);

  update public.documents
  set contractual_parent_document_id = null,
      contractual_incorporation_basis = null,
      contractual_linked_by_user_id = null,
      contractual_linked_at = null
  where id = p_child_document_id;

  -- Auditoria — MESMA transação do UPDATE acima (ver comentário
  -- equivalente em link_document_as_contractual_attachment): uma falha
  -- aqui desfaz a desvinculação inteira. Registra explicitamente os
  -- valores NOVOS (todos "nenhum(a)", já que desvincular sempre limpa
  -- os 4 metadados juntos) — nunca deixa isso só implícito em
  -- "removido".
  insert into public.audit_log_entries (
    project_id,
    actor_type,
    actor_user_id,
    actor_label,
    action,
    entity_type,
    entity_id,
    detail
  )
  values (
    p_project_id,
    'USER',
    v_user_id,
    null,
    'DOCUMENT_CONTRACTUAL_ATTACHMENT_UNLINKED',
    'DOCUMENT',
    p_child_document_id::text,
    format(
      'Vínculo contratual removido. Documento: "%s" (%s). Pai anterior: %s. Pai novo: (nenhum). Fundamento anterior: %s. Fundamento novo: (nenhum). Usuário anterior do vínculo: %s. Usuário novo do vínculo: (nenhum). Data anterior do vínculo: %s. Data nova do vínculo: (nenhuma). Justificativa da desvinculação: %s. Ator desta ação: %s. Momento desta ação: %s.',
      coalesce(v_child_title, p_child_document_id::text),
      p_child_document_id::text,
      v_previous_parent_id::text,
      coalesce(v_previous_basis, '(nenhum)'),
      coalesce(v_previous_linked_by::text, '(nenhum)'),
      coalesce(v_previous_linked_at::text, '(nenhuma)'),
      v_reason,
      v_user_id::text,
      now()::text
    )
  );

end;
$$;

alter function public.unlink_document_contractual_attachment(uuid, uuid, text) owner to postgres;
revoke execute on function public.unlink_document_contractual_attachment(uuid, uuid, text) from public;
revoke execute on function public.unlink_document_contractual_attachment(uuid, uuid, text) from anon;
grant execute on function public.unlink_document_contractual_attachment(uuid, uuid, text) to authenticated;
-- SEM grant a service_role — mesmo motivo de link_document_as_contractual_attachment acima.

notify pgrst, 'reload schema';
