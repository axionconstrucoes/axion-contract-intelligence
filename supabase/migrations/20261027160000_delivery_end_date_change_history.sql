-- Histórico da alteração do término previsto da obra para as providências de entrega.
--
-- O recálculo dos marcos (D−60 e prazos individuais) é feito SEM estado a partir de
-- projects.baseline_end_date (lib/delivery/delivery-items.ts), então basta registrar a mudança.
-- Um gatilho cobre TODOS os caminhos de edição (tela da obra, startup, RPCs) sem alterar código
-- existente. Nada é apagado: prazos individuais vencidos continuam vencidos.
--
-- PREPARADA, NÃO APLICADA. Depende de 20261027130000_project_delivery_items.sql.

create or replace function public.project_delivery_items_log_end_date_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.baseline_end_date is distinct from old.baseline_end_date then
    insert into public.project_delivery_item_events (item_id, project_id, kind, actor_user_id, detail)
    select i.id, i.project_id, 'END_DATE_CHANGED', auth.uid(),
           'Término previsto: ' || coalesce(to_char(old.baseline_end_date, 'YYYY-MM-DD'), 'sem data')
           || ' → ' || coalesce(to_char(new.baseline_end_date, 'YYYY-MM-DD'), 'sem data')
           || '. Marcos futuros recalculados; atrasos registrados preservados.'
    from public.project_delivery_items i
    where i.project_id = new.id;
  end if;
  return new;
end;
$$;

revoke all on function public.project_delivery_items_log_end_date_change() from public, anon, authenticated;

create trigger project_delivery_items_log_end_date_change
after update of baseline_end_date on public.projects
for each row execute function public.project_delivery_items_log_end_date_change();
