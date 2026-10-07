FNR==1{if(f)print f,t,n,l,c,m,io,a; f=FILENAME;t=0;n=0;l=0;c=0;m=0;io=0;a=0}
/^timestamp=/{split($0,x,"=");t=x[2]}
/ FORGEJO-ACTIONS-TASK-/{n++}
/^loadavg/{l=$2}
/^psi cpu/{split($4,x,"=");c=x[2]}
/^psi memory/{split($4,x,"=");m=x[2]}
/^psi io/{split($4,x,"=");io=x[2]}
/^meminfo/{split($3,x,":");a=x[2]}
END{print f,t,n,l,c,m,io,a}
