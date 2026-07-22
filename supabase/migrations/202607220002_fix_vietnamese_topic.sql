alter table public.question_sets
  alter column topic set default 'Tổng hợp';

update public.question_sets
set topic = 'Tổng hợp'
where topic = 'T?ng h?p';
