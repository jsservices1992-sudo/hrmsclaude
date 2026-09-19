-- How the ESI definition of wages treats each component and each kind of
-- variable pay. Null means derive it: the Code's own classification for the
-- codes it names, the old esic_base flag for everything else.
alter table pay_components
  add column esic_treatment text;

alter table variable_pay_types
  add column esic_treatment text;
