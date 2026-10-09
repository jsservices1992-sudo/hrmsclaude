-- Repair only the unverified global seed, not reviewed rules or employer overrides.
UPDATE minimum_wages
SET effective_from = '2025-04-01',
    source = 'Delhi Labour Commissioner order dated 15 April 2025, effective 1 April 2025. Original: https://labour.delhi.gov.in/sites/default/files/Labour/generic_multiple_files/da15april2025.pdf . Graduate-and-above is clerical/supervisory; review establishment/category applicability and later notifications.'
WHERE state_code = 'DL' AND company_id IS NULL AND zone IS NULL
  AND verified = false AND effective_from = '2026-04-01'
  AND monthly_paise IN (1845600, 2037100, 2241100, 2435600)
  AND source LIKE 'Delhi minimum wage notification, basic + VDA, supplied by the owner%';
