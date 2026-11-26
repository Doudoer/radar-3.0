-- Migration 044: Remove penalties generated from internal numbers, 169014, and 9844004618
DELETE FROM order_penalties
 WHERE source IN ('call_missed', 'call_rejected')
   AND (
     reference_key LIKE '%169014%'
     OR reference_key LIKE '%9844004618%'
     OR SUBSTRING_INDEX(SUBSTRING_INDEX(reference_key, '-', 2), '-', -1) IN (
       SELECT CAST(id AS CHAR) FROM pbx_call_logs
        WHERE caller_number LIKE '%169014%'
           OR caller_number LIKE '%9844004618%'
           OR caller_name LIKE '%169014%'
           OR caller_name LIKE '%9844004618%'
           OR direction = 'internal'
           OR CHAR_LENGTH(caller_number) <= 4
     )
   );
