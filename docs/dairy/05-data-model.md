# 5. Data model

Postgres. Every table carries `farm_id`. Every row carries a client-generated
UUID primary key so offline writes are idempotent.

Types shown as Postgres DDL sketches — close to what the Drizzle schema will be,
but readable without knowing Drizzle.

---

## 5.1 Principles

| # | Principle | Consequence |
| - | --------- | ----------- |
| P1 | **Store events, derive state** | Animal class, reproductive status, days in milk, every KPI — all computed. Never a `status` column the app has to keep in sync |
| P2 | **Client generates the UUID** | `INSERT … ON CONFLICT (id) DO NOTHING` makes a double-flush harmless. This removes ~90% of offline sync complexity |
| P3 | **Append-only for high-volume capture** | Milk records, feed issues, health events. Corrections are new rows with `supersedes_id`, not updates. Conflicts become structurally impossible |
| P4 | **`farm_id` on every table, checked in every query** | Multi-tenancy from day one. RLS as defence in depth, not as the only guard |
| P5 | **Reference data is versioned with effective dates** | Wage rates, milk prices, feed prices all change. Historical records must keep the rate that applied at the time |
| P6 | **Money is `numeric(14,2)`, never float** | KES. Quantities are `numeric(10,3)` |
| P7 | **Every record knows who entered it and who approved it** | Segregation of duties, permanently visible |
| P8 | **Units are never implicit** | A bale is not a weight. `quantity` + `unit` + `unit_weight_kg`, always |

---

## 5.2 Foundation

```sql
create table farm (
  id                uuid primary key,
  name              text not null,
  county            text,
  system_type       text check (system_type in ('ZERO_GRAZING','SEMI_INTENSIVE','OPEN_GRAZING')),
  milking_sessions  smallint not null default 2,      -- 2 or 3
  default_currency  text not null default 'KES',
  coop_id           uuid references counterparty(id), -- primary milk buyer
  member_no         text,                             -- the farm's co-op member number
  created_at        timestamptz not null default now()
);

create table app_user (
  id            uuid primary key,
  farm_id       uuid not null references farm(id),
  full_name     text not null,
  photo_url     text,
  phone         text,
  pin_hash      text not null,          -- 4-digit PIN, argon2
  role          text not null check (role in ('OWNER','MANAGER','HERDSMAN','VET','ACCOUNTANT')),
  language      text not null default 'en' check (language in ('en','sw')),
  active        boolean not null default true
);

-- Versioned reference data. One pattern, many uses.
create table reference_value (
  id            uuid primary key,
  farm_id       uuid references farm(id),   -- null = system default, inheritable
  kind          text not null,              -- 'MILK_PRICE','WAGE_MIN','GESTATION_DAYS','FEED_RULE'…
  key           text not null,              -- e.g. 'FRIESIAN', 'HERDSMAN', 'COOP_RATE'
  value_numeric numeric(14,4),
  value_text    text,
  effective_from date not null,
  effective_to   date,
  source         text                       -- 'KDB 2026', 'Gazette LN 95/2026' — provenance matters
);

create table audit_entry (
  id          uuid primary key,
  farm_id     uuid not null,
  table_name  text not null,
  row_id      uuid not null,
  action      text not null check (action in ('INSERT','UPDATE','DELETE','APPROVE')),
  actor_id    uuid not null references app_user(id),
  at          timestamptz not null default now(),
  before      jsonb,
  after       jsonb
);

-- Every user-facing save gets a short, human-readable reference code (the M-Pesa pattern)
create table receipt (
  id          uuid primary key,
  farm_id     uuid not null,
  ref_code    text not null,              -- 'MK4T9' — short, speakable, unique per farm per day
  kind        text not null,              -- 'MILK','FEED','TREATMENT','PAYMENT'…
  summary     text not null,              -- rendered plain-language line, stored so it never changes
  actor_id    uuid not null,
  at          timestamptz not null,
  payload     jsonb
);
```

---

## 5.3 Herd

```sql
create table animal (
  id                 uuid primary key,
  farm_id            uuid not null references farm(id),
  tag                text not null,                  -- ear tag, ICAR-style
  name               text,                           -- Kenyan farmers name their cows
  sex                text not null check (sex in ('F','M')),
  breed_composition  text,                           -- '3/4 Friesian x 1/4 Zebu'
  primary_breed      text,                           -- drives gestation length
  date_of_birth      date,
  dob_estimated      boolean not null default false, -- bought-in animals
  sire_id            uuid references animal(id),
  dam_id             uuid references animal(id),
  sire_straw_code    text,                           -- when sired by AI, no on-farm sire record
  origin             text not null check (origin in ('BORN','PURCHASED','GIFT','DONATION')),
  entered_herd_on    date not null,
  purchase_price_kes numeric(14,2),
  klba_reg_no        text,                           -- Kenya Livestock Breeders / DRSK
  photo_url          text,
  class_override     text,                           -- ONLY for bought-in animals with unknown history
  notes              text,
  unique (farm_id, tag)
);

create table animal_exit (
  id          uuid primary key,
  farm_id     uuid not null,
  animal_id   uuid not null references animal(id),
  exit_date   date not null,
  reason      text not null check (reason in
                ('SOLD','DIED','SLAUGHTERED','CULLED','STOLEN','LOST')),
  cause       text,                       -- for deaths
  value_kes   numeric(14,2),
  counterparty_id uuid references counterparty(id),
  -- what drove the price, for sales
  class_at_exit        text,
  weight_kg            numeric(8,2),
  months_pregnant      smallint,
  daily_yield_at_sale_l numeric(6,2),
  days_in_milk_at_sale int
);

create table weight_observation (
  id          uuid primary key,
  farm_id     uuid not null,
  animal_id   uuid not null references animal(id),
  observed_on date not null,
  weight_kg   numeric(8,2),
  method      text check (method in ('SCALE','HEART_GIRTH','ESTIMATE')),
  bcs         numeric(3,2) check (bcs >= 1.00 and bcs <= 5.00),  -- 0.25 steps
  recorded_by uuid not null references app_user(id)
);
```

### The derived class

A view, not a column. Simplified logic — the real implementation walks the event
history:

```sql
create view animal_current as
select a.id, a.farm_id, a.tag, a.name, a.sex,
  -- parity: number of calvings
  (select count(*) from calving c where c.dam_id = a.id) as parity,
  -- reproductive status from the latest service / PD / calving / dry-off
  case
    when x.dried_off_at   is not null and x.dried_off_at   > coalesce(x.last_calving,'-infinity') then 'DRY'
    when x.pd_positive_at is not null and x.pd_positive_at > coalesce(x.last_calving,'-infinity') then 'PREGNANT'
    when x.last_service   is not null and x.last_service   > coalesce(x.last_calving,'-infinity') then 'SERVED'
    when x.last_calving   is not null and now()::date - x.last_calving <= 60                      then 'FRESH'
    else 'OPEN'
  end as repro_status,
  -- class: sex, age, parity and repro status together
  case
    when a.sex = 'M' and x.castrated then 'STEER'
    when a.sex = 'M' and age_months(a.date_of_birth) < 6  then 'BULL_CALF'
    when a.sex = 'M'                                       then 'BULL'
    when x.parity = 0 and age_months(a.date_of_birth) < 3  then 'CALF'
    when x.parity = 0 and age_months(a.date_of_birth) < 9  then 'WEANER'
    when x.parity = 0 and x.pd_positive_at is not null
         and x.edd - now()::date <= 56                     then 'SPRINGER'
    when x.parity = 0 and x.pd_positive_at is not null     then 'INCALF_HEIFER'
    when x.parity = 0 and x.last_service   is not null     then 'SERVED_HEIFER'
    when x.parity = 0 and (x.latest_weight >= 280
         or age_months(a.date_of_birth) >= 14)             then 'BULLING_HEIFER'
    when x.parity = 0                                      then 'HEIFER'
    when x.dried_off_at is not null                        then 'DRY_COW'
    when x.parity = 1                                      then 'FIRST_CALVER'
    when x.parity >= 3                                     then 'MATURE_COW'
    else 'LACTATING_COW'
  end as animal_class,
  x.*
from animal a
join animal_derived x on x.animal_id = a.id
where not exists (select 1 from animal_exit e where e.animal_id = a.id);
```

`class_override` on `animal` wins where set, for bought-in animals.

---

## 5.4 Breeding

```sql
create table heat_observation (
  id          uuid primary key,
  farm_id     uuid not null,
  animal_id   uuid not null references animal(id),
  observed_at timestamptz not null,
  sign        text check (sign in ('STANDING','MOUNTING_OTHERS','MUCUS','RESTLESS','SWOLLEN_VULVA','YIELD_DROP')),
  recorded_by uuid not null references app_user(id)
  -- AM/PM rule applied in the UI: morning heat → inseminate evening, and vice versa
);

create table service (
  id              uuid primary key,
  farm_id         uuid not null,
  animal_id       uuid not null references animal(id),
  served_on       date not null,
  service_type    text not null check (service_type in ('AI','NATURAL','ET')),
  semen_type      text check (semen_type in ('CONVENTIONAL','SEXED')),
  straw_code      text,
  straw_batch     text,
  sire_breed      text,
  bull_id         uuid references animal(id),        -- natural service
  inseminator_id  uuid references counterparty(id),
  service_number  smallint not null default 1,       -- nth service this pregnancy attempt
  cost_kes        numeric(14,2),
  cost_settled_by text check (cost_settled_by in ('CASH','CREDIT','COOP_CHECKOFF')),
  -- derived and stored at insert so the calendar is stable even if constants change
  expected_return_on  date,   -- +21 d
  pd_due_on           date,   -- +60 d
  expected_calving_on date,   -- + gestation_days(primary_breed), default 283
  recorded_by     uuid not null references app_user(id)
);

create table pregnancy_check (
  id          uuid primary key,
  farm_id     uuid not null,
  service_id  uuid not null references service(id),
  animal_id   uuid not null references animal(id),
  checked_on  date not null,
  method      text not null check (method in
                ('PALPATION','ULTRASOUND','PROGESTERONE','PAG','NON_RETURN')),
  result      text not null check (result in ('POSITIVE','NEGATIVE','INCONCLUSIVE')),
  months_pregnant  numeric(3,1),
  performed_by     uuid references counterparty(id),
  cost_kes         numeric(14,2)
);

create table calving (
  id                uuid primary key,
  farm_id           uuid not null,
  dam_id            uuid not null references animal(id),
  service_id        uuid references service(id),
  calved_on         date not null,
  calving_ease      smallint check (calving_ease between 1 and 5),
  -- 1 unassisted, 2 easy pull, 3 hard pull, 4 vet assisted, 5 caesarean
  number_born       smallint not null default 1,
  retained_placenta boolean not null default false,   -- flag if not passed in 6–12 h
  milk_fever        boolean not null default false,
  assisted_by       uuid references counterparty(id),
  notes             text
);

create table calving_outcome (          -- one row per calf born
  id            uuid primary key,
  farm_id       uuid not null,
  calving_id    uuid not null references calving(id),
  outcome       text not null check (outcome in
                  ('LIVE','STILLBIRTH','DIED_UNDER_24H','ABORTION')),
  calf_sex      text check (calf_sex in ('F','M')),
  birth_weight_kg numeric(6,2),
  animal_id     uuid references animal(id)    -- the created CALF record, when LIVE
);

create table dry_off (
  id          uuid primary key,
  farm_id     uuid not null,
  animal_id   uuid not null references animal(id),
  dried_on    date not null,
  method      text check (method in ('ABRUPT','GRADUAL')),
  dry_cow_therapy_product_id uuid references product(id),   -- sets a withdrawal
  recorded_by uuid not null references app_user(id)
);
```

**The return-to-heat interpretation** is a query, not a column:

| Days since last service | Interpretation surfaced to the user |
| ----------------------- | ----------------------------------- |
| 18–24 | Normal return — one cycle missed |
| 3–17 | Wrong-timing insemination or early embryonic loss |
| 40–45 | **A missed heat** — detection failure, not fertility failure |
| >25, not a multiple of 21 | Suspect record error or irregular cycling |

---

## 5.5 Milk

```sql
create table milk_record (          -- APPEND ONLY. The highest-volume table in the system.
  id            uuid primary key,   -- client-generated
  farm_id       uuid not null,
  animal_id     uuid not null references animal(id),
  recorded_on   date not null,
  session       text not null check (session in ('MORNING','NOON','EVENING')),
  litres        numeric(6,2) not null,
  saleable      boolean not null default true,   -- false for colostrum / withdrawal
  not_saleable_reason text check (not_saleable_reason in ('COLOSTRUM','WITHDRAWAL')),
  flagged       boolean not null default false,  -- out of range, saved anyway
  flag_reason   text,
  supersedes_id uuid references milk_record(id), -- corrections are new rows
  recorded_by   uuid not null references app_user(id),
  approved_by   uuid references app_user(id),
  recorded_at   timestamptz not null,
  synced_at     timestamptz,
  unique (farm_id, animal_id, recorded_on, session, recorded_at)
);

create table milk_disposal (        -- where the day's milk went
  id          uuid primary key,
  farm_id     uuid not null,
  disposed_on date not null,
  channel     text not null check (channel in (
                'COOP_DELIVERY','PROCESSOR_DIRECT','DIRECT_SALE','HOME_CONSUMPTION',
                'CALF_FEEDING','STAFF_RATION','SPOILAGE','REJECTED',
                'WITHHELD_TREATMENT','WITHHELD_COLOSTRUM')),
  litres      numeric(8,2) not null,
  counterparty_id uuid references counterparty(id),
  rate_kes_per_litre numeric(8,2),      -- imputed at market price for non-revenue channels
  value_kes   numeric(14,2),
  -- quality, per delivery
  butterfat_pct numeric(4,2),
  protein_pct   numeric(4,2),
  snf_pct       numeric(4,2),
  lactometer_reading numeric(6,4),
  alcohol_test  text check (alcohol_test in ('PASS','FAIL')),
  accepted      boolean,
  reject_reason text,
  delivery_note_no text,
  recorded_by uuid not null references app_user(id)
);
```

**The daily reconciliation** is a view, and the variance is shown, not hidden:

```sql
create view milk_daily_reconciliation as
select farm_id, d as day,
       produced_saleable_l,
       disposed_l,
       produced_saleable_l - disposed_l as variance_l
from ( … ) t;
```

### The co-op statement

```sql
create table milk_statement (
  id             uuid primary key,
  farm_id        uuid not null,
  counterparty_id uuid not null references counterparty(id),  -- the co-op
  member_no      text,
  period_start   date not null,
  period_end     date not null,
  coop_litres    numeric(10,2) not null,     -- what the CO-OP says
  rate_kes_per_litre numeric(8,2),
  quality_bonus_kes  numeric(14,2) default 0,
  gross_pay_kes  numeric(14,2) not null,
  cess_kes       numeric(14,2) default 0,    -- county cess, ≤0.5% of farm gate
  net_pay_kes    numeric(14,2) not null,
  paid_on        date,
  payment_method text
);

create table milk_statement_deduction (
  id             uuid primary key,
  statement_id   uuid not null references milk_statement(id),
  deduction_type text not null check (deduction_type in (
                   'AI','FEEDS','VET','ADVANCE','SACCO_LOAN','SHARES',
                   'TRANSPORT','MEMBERSHIP','OTHER')),
  description    text,
  amount_kes     numeric(14,2) not null,
  balance_remaining_kes numeric(14,2),
  matched_expense_id uuid references expense(id)   -- ← the reconciliation link
);
```

**The reconciliation view** compares `coop_litres` against the farm's own
`milk_disposal` rows for the period, and each deduction against a matching
recorded expense. Unmatched deductions are the whole point.

---

## 5.6 Feed

```sql
create table feed_item (
  id            uuid primary key,
  farm_id       uuid not null,
  name          text not null,               -- 'Dairy meal (Unga)', 'Boma Rhodes hay'
  category      text not null check (category in
                  ('FODDER','CONCENTRATE','MINERAL','WATER','OTHER')),
  dm_pct        numeric(5,2),                -- dry matter %
  cp_pct        numeric(5,2),                -- crude protein %
  default_unit  text not null,               -- 'BAG_70KG','BALE','KG','TONNE'…
  default_unit_weight_kg numeric(8,3),       -- NEVER null for BAG / BALE / informal units
  home_grown    boolean not null default false
);

create table feed_purchase (
  id            uuid primary key,
  farm_id       uuid not null,
  feed_item_id  uuid not null references feed_item(id),
  supplier_id   uuid references counterparty(id),
  purchased_on  date not null,
  quantity      numeric(10,3) not null,
  unit          text not null,
  unit_weight_kg numeric(8,3) not null,      -- ← the trap, closed
  total_kg      numeric(12,3) generated always as (quantity * unit_weight_kg) stored,
  unit_price_kes numeric(14,2) not null,
  total_cost_kes numeric(14,2) not null,
  expense_id    uuid references expense(id),
  recorded_by   uuid not null references app_user(id)
);

create table feed_issue (           -- APPEND ONLY
  id            uuid primary key,
  farm_id       uuid not null,
  feed_item_id  uuid not null references feed_item(id),
  issued_on     date not null,
  animal_group  text check (animal_group in
                  ('LACTATING','DRY','HEIFERS','CALVES','BULLS','ALL')),
  animal_id     uuid references animal(id),  -- optional per-animal capture
  quantity      numeric(10,3) not null,
  unit          text not null,
  unit_weight_kg numeric(8,3) not null,
  total_kg      numeric(12,3) generated always as (quantity * unit_weight_kg) stored,
  animals_fed   smallint,
  recorded_by   uuid not null references app_user(id)
);

create table fodder_production (
  id            uuid primary key,
  farm_id       uuid not null,
  plot_name     text,
  crop          text not null,               -- 'Napier (Bana)', 'Boma Rhodes'
  area_acres    numeric(8,3),
  planted_on    date,
  harvested_on  date,
  quantity      numeric(10,3),
  unit          text,
  unit_weight_kg numeric(8,3),
  input_cost_kes numeric(14,2)
);
```

**Derived:** stock balance per feed item (purchases − issues), cost per kg, cost
per kg DM, **days of cover** at the trailing 7-day issue rate, and **margin over
feed cost per litre** — the headline number.

---

## 5.7 Health

```sql
create table product (              -- the drug/vaccine master. Withdrawal lives HERE.
  id                    uuid primary key,
  farm_id               uuid references farm(id),   -- null = shared catalogue
  name                  text not null,
  active_ingredient     text,
  product_type          text not null check (product_type in
                          ('ANTIBIOTIC','VACCINE','DEWORMER','ACARICIDE','NSAID',
                           'INTRAMAMMARY','MINERAL','HORMONE','OTHER')),
  milk_withdrawal_days  smallint,     -- FROM THE LABEL. Never inferred.
  meat_withdrawal_days  smallint,
  label_source          text,         -- 'PCPB label, 2026' — provenance is the legal defence
  not_for_lactating     boolean not null default false   -- e.g. injectable ivermectin
);

create table health_event (         -- APPEND ONLY
  id                uuid primary key,
  farm_id           uuid not null,
  animal_id         uuid not null references animal(id),
  event_type        text not null check (event_type in
                      ('OBSERVATION','TREATMENT','VACCINATION','DEWORMING',
                       'DIPPING','HOOF_TRIM','DISBUDDING','CMT','DIAGNOSIS')),
  occurred_on       date not null,
  signs             text,
  diagnosis         text,
  product_id        uuid references product(id),
  batch_no          text,
  expiry            date,
  dose              text,
  route             text check (route in
                      ('IM','IV','SC','PO','INTRAMAMMARY','TOPICAL','INTRAUTERINE')),
  quarters_treated  text[],          -- for intramammary: {'LF','RF','LH','RH'}
  duration_days     smallint,
  treatment_end_on  date,
  -- computed at insert from product + treatment_end_on
  milk_clear_at     timestamptz,
  meat_clear_at     date,
  cmt_score         text check (cmt_score in ('N','T','1','2','3')),
  performed_by_user uuid references app_user(id),
  performed_by_ext  uuid references counterparty(id),
  cost_kes          numeric(14,2),
  cost_settled_by   text check (cost_settled_by in ('CASH','CREDIT','COOP_CHECKOFF')),
  outcome           text check (outcome in ('RECOVERED','CHRONIC','CULLED','DIED','ONGOING')),
  follow_up_on      date,
  expense_id        uuid references expense(id),
  recorded_by       uuid not null references app_user(id)
);

create table routine_schedule (     -- vaccination & routine templates
  id                     uuid primary key,
  farm_id                uuid not null,
  routine                text not null,      -- 'FMD','S19','ECF_ITM','DEWORM','DIP'
  first_dose_min_age_days int,
  first_dose_max_age_days int,               -- S19: 120–240 days
  booster_interval_days   int,               -- FMD: 180
  sex_restriction         text check (sex_restriction in ('F','M')),
  once_in_lifetime        boolean not null default false   -- S19, ECF-ITM
);
```

**The withdrawal block is a query used everywhere:**

```sql
create view animal_withdrawal as
select animal_id, farm_id,
       max(milk_clear_at) filter (where milk_clear_at > now()) as milk_blocked_until,
       max(meat_clear_at) filter (where meat_clear_at > current_date) as meat_blocked_until
from health_event
group by animal_id, farm_id;
```

The milk entry screen, the disposal screen and the animal sale screen all consult
this view. It is the only hard block in the system.

---

## 5.8 People and payroll

```sql
create table employee (
  id                uuid primary key,
  farm_id           uuid not null,
  app_user_id       uuid references app_user(id),   -- if they use the app
  full_name         text not null,
  national_id       text,
  kra_pin           text,
  nssf_no           text,
  sha_no            text,
  phone             text,
  role              text not null,          -- 'MANAGER','HERDSMAN','FEEDER','CASUAL','WATCHMAN'…
  employment_type   text not null check (employment_type in ('PERMANENT','TERM','CASUAL')),
  started_on        date not null,
  ended_on          date,
  basic_wage_kes    numeric(14,2),
  wage_period       text check (wage_period in ('MONTHLY','DAILY')),
  housing_provided  boolean not null default true,   -- else 15% housing allowance
  next_of_kin       text
);

create table attendance (
  id           uuid primary key,
  farm_id      uuid not null,
  employee_id  uuid not null references employee(id),
  worked_on    date not null,
  days         numeric(3,2) not null default 1,
  recorded_by  uuid not null references app_user(id),
  unique (employee_id, worked_on)
);

create table payroll_run (
  id            uuid primary key,
  farm_id       uuid not null,
  period_month  date not null,           -- first of month
  status        text not null check (status in ('DRAFT','APPROVED','PAID')),
  approved_by   uuid references app_user(id),
  total_gross_kes numeric(14,2),
  total_net_kes   numeric(14,2)
);

create table payslip (
  id                 uuid primary key,
  farm_id            uuid not null,
  payroll_run_id     uuid not null references payroll_run(id),
  employee_id        uuid not null references employee(id),
  days_worked        numeric(5,2),
  basic_kes          numeric(14,2) not null,
  housing_allow_kes  numeric(14,2) default 0,     -- 15% where accommodation not provided
  gross_kes          numeric(14,2) not null,
  nssf_tier1_kes     numeric(14,2) default 0,     -- 6% to LEL 9,000 → max 540
  nssf_tier2_kes     numeric(14,2) default 0,     -- 6% LEL→UEL 108,000 → max 5,940
  shif_kes           numeric(14,2) default 0,     -- 2.75% of gross, min 300, no cap
  housing_levy_kes   numeric(14,2) default 0,     -- 1.5% of gross
  taxable_kes        numeric(14,2),
  paye_before_relief_kes numeric(14,2) default 0,
  personal_relief_kes    numeric(14,2) default 2400,
  paye_kes           numeric(14,2) default 0,     -- often ZERO. Must be handled correctly
  advances_kes       numeric(14,2) default 0,
  other_deductions_kes numeric(14,2) default 0,
  milk_ration_kes    numeric(14,2) default 0,     -- benefit in kind
  net_kes            numeric(14,2) not null,
  paid_on            date,
  payment_method     text,
  mpesa_ref          text
);

create table leave_record (
  id           uuid primary key,
  farm_id      uuid not null,
  employee_id  uuid not null references employee(id),
  leave_type   text not null check (leave_type in
                 ('ANNUAL','SICK_FULL','SICK_HALF','MATERNITY','PATERNITY','UNPAID')),
  from_date    date not null,
  to_date      date not null,
  days         numeric(5,2) not null
);
```

**Employer contributions are computed and reported but not deducted from net** —
NSSF matched 6%, and SHIF at 1.375% if confirmed (see
[08-open-questions.md](08-open-questions.md)).

**The casual-conversion warning** is a query: any `CASUAL` with continuous
attendance approaching 30 days raises an alert, because under the Employment Act
2007 they convert by operation of law into a term employee with full benefits.

---

## 5.9 Money

```sql
create table counterparty (         -- suppliers, buyers, service providers, co-ops
  id            uuid primary key,
  farm_id       uuid not null,
  name          text not null,
  types         text[] not null,    -- {'AGROVET','FEED_MILLER','HAY','AI_PROVIDER','VET',
                                    --  'TRANSPORTER','COOP','PROCESSOR','BUYER','BROKER'}
  provider_kind text check (provider_kind in
                  ('FARM_STAFF','AI_TECH','PARAVET','VET','COOP_VET','COUNTY')),
  kvb_reg_no    text,               -- Kenya Veterinary Board, where applicable
  phone         text,
  payment_terms text,
  credit_balance_kes numeric(14,2) default 0
);

create table expense (
  id             uuid primary key,
  farm_id        uuid not null,
  incurred_on    date not null,
  category       text not null check (category in (
                   'FEEDS','LABOUR','VETERINARY','BREEDING','MILK_MARKETING',
                   'UTILITIES','MACHINERY','COOLING','RENT','LOAN','INSURANCE',
                   'BEDDING','LICENCES','MANURE','TRANSPORT','OTHER')),
  description    text,
  counterparty_id uuid references counterparty(id),
  amount_kes     numeric(14,2) not null,
  payment_method text check (payment_method in
                   ('CASH','MPESA','BANK','COOP_CHECKOFF','CREDIT')),
  mpesa_ref      text,
  voucher_no     text,
  attachment_url text,                       -- photo of the receipt
  status         text not null default 'PENDING'
                   check (status in ('PENDING','APPROVED','VOID')),
  recorded_by    uuid not null references app_user(id),
  approved_by    uuid references app_user(id)
);

create table income (
  id             uuid primary key,
  farm_id        uuid not null,
  received_on    date not null,
  source         text not null check (source in
                   ('MILK','ANIMAL_SALE','MANURE','FODDER','OTHER')),
  description    text,
  counterparty_id uuid references counterparty(id),
  amount_kes     numeric(14,2) not null,
  payment_method text,
  mpesa_ref      text,
  status         text not null default 'PENDING'
);

create table mpesa_statement_line (      -- imported CSV, for reconciliation
  id            uuid primary key,
  farm_id       uuid not null,
  receipt_no    text not null,
  completed_at  timestamptz not null,
  details       text,
  paid_in_kes   numeric(14,2),
  withdrawn_kes numeric(14,2),
  balance_kes   numeric(14,2),
  matched_expense_id uuid references expense(id),
  matched_income_id  uuid references income(id),
  unique (farm_id, receipt_no)
);
```

---

## 5.10 Training and support

```sql
create table training_event (
  id           uuid primary key,
  farm_id      uuid not null,
  title        text not null,
  kind         text check (kind in ('SEMINAR','ON_FARM','ONLINE','FIELD_DAY')),
  held_on      date,
  trainer      text,
  topic        text,
  cost_kes     numeric(14,2),
  materials_url text,
  expense_id   uuid references expense(id)
);

create table training_attendance (
  id                uuid primary key,
  training_event_id uuid not null references training_event(id),
  employee_id       uuid references employee(id),
  attendee_name     text
);

create table support_ticket (
  id           uuid primary key,
  farm_id      uuid not null,
  raised_by    uuid not null references app_user(id),
  raised_at    timestamptz not null default now(),
  screen       text,              -- captured automatically
  sync_state   jsonb,             -- captured automatically
  message      text not null,
  status       text not null default 'OPEN',
  resolved_at  timestamptz
);
```

---

## 5.11 The sync outbox (client side, IndexedDB)

Not a Postgres table — this lives in the browser via Dexie.

```ts
interface OutboxEntry {
  id: string            // the row UUID, generated client-side — the idempotency key
  table: string         // 'milk_record' | 'feed_issue' | …
  payload: unknown
  createdAt: number
  attempts: number
  lastError?: string
}
```

Server side, every ingest endpoint is
`INSERT … ON CONFLICT (id) DO NOTHING RETURNING id`. A double-flush over a flaky
link is a no-op.

---

## 5.12 Indexes that matter

```sql
create index on milk_record   (farm_id, recorded_on desc, animal_id);
create index on milk_record   (farm_id, animal_id, recorded_on desc);
create index on milk_disposal (farm_id, disposed_on desc);
create index on health_event  (farm_id, animal_id, occurred_on desc);
create index on health_event  (farm_id, milk_clear_at) where milk_clear_at is not null;
create index on service       (farm_id, animal_id, served_on desc);
create index on service       (farm_id, expected_calving_on) where expected_calving_on is not null;
create index on feed_issue    (farm_id, issued_on desc, feed_item_id);
create index on expense       (farm_id, incurred_on desc, category);
create index on animal        (farm_id, tag);
```

The lactation and margin reports are window functions over `milk_record`
partitioned by `(animal_id, lactation_number)` — one of the reasons Postgres wins
over SQLite-shaped alternatives here.

---

## 5.13 Row-level security

RLS is defence in depth. **Application queries still filter by `farm_id`
explicitly** — RLS is the second lock, not the only one.

```sql
alter table milk_record enable row level security;

create policy tenant_isolation on milk_record
  using (farm_id = current_setting('app.farm_id')::uuid);
```

`app.farm_id` is set per request from the verified session in the data access
layer, never from a client-supplied value.
