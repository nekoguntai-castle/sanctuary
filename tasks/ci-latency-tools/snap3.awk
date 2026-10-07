/ FORGEJO-ACTIONS-TASK-/{match($0,/TASK-[0-9]+/); id=substr($0,RSTART+5,RLENGTH-5); j=$0; sub(/.*_JOB-/,"",j); sub(/ Up .*/,"",j); print id"\t"j}
