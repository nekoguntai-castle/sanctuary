FNR==1{if(f&&ids!="")print t, ids; f=FILENAME;t=0;ids=""}
/^timestamp=/{split($0,x,"=");t=x[2]}
/ FORGEJO-ACTIONS-TASK-/{match($0,/TASK-[0-9]+/); ids=ids" "substr($0,RSTART+5,RLENGTH-5)}
END{if(ids!="")print t, ids}
