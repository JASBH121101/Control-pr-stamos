-- Keep the business date of the loan separate from the row-creation timestamp.
-- Existing loans retain the date on which they were originally recorded in Managua.
ALTER TABLE public.loans
  ADD COLUMN IF NOT EXISTS loan_date date;

UPDATE public.loans
SET loan_date = (created_at AT TIME ZONE 'America/Managua')::date
WHERE loan_date IS NULL;

ALTER TABLE public.loans
  ALTER COLUMN loan_date
  SET DEFAULT ((now() AT TIME ZONE 'America/Managua')::date);

ALTER TABLE public.loans
  ALTER COLUMN loan_date SET NOT NULL;
