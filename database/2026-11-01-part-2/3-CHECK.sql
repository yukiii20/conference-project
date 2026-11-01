-- =====================================================================
-- STEP 3 - CHECK: run after 1-LOCAL / 2-AIVEN. The row should say OK.
-- =====================================================================
SELECT 'roles.super_admin (super administrator)' AS checked,
       IF(EXISTS(SELECT 1 FROM roles WHERE code = 'super_admin' AND scope = 'platform'), 'OK', 'MISSING') AS status;
