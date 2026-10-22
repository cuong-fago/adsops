-- "Nhóm của tôi": personal compare groups (owner = creator's email, lower-case). NULL owner = shared group.
alter table compare_groups add column if not exists owner text;
drop index if exists compare_groups_name;
create unique index if not exists compare_groups_owner_name on compare_groups (coalesce(owner, ''), lower(name));
create index if not exists compare_groups_owner on compare_groups (owner);
