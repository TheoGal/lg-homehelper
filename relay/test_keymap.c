#include "filter.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>
static int key(struct keymap*k,unsigned code,int value){struct ev e={0,0,1,code,value};return keymap_event(k,&e);}
static void send(struct keymap*k,const char*s){while(*s)keymap_command(k,*s++);}
int main(void){
 struct keymap k;memset(&k,0,sizeof k);
 /* Nothing mapped: every key passes. */
 assert(key(&k,1100,1)==KM_PASS);assert(key(&k,1100,0)==KM_PASS);
 /* Learning swallows the next learnable press, its repeats and its release. */
 send(&k,"L");
 assert(key(&k,773,1)==KM_PASS);assert(key(&k,773,0)==KM_PASS);   /* Home is never learned */
 assert(key(&k,412,1)==KM_PASS);assert(key(&k,103,1)==KM_PASS);   /* Back, arrows */
 assert(key(&k,272,1)==KM_PASS);assert(key(&k,5,1)==KM_PASS);     /* pointer click, digit */
 for(unsigned c=398;c<=401;c++)assert(key(&k,c,1)==KM_PASS);       /* coloured keys */
 assert(key(&k,512,1)==KM_PASS);assert(key(&k,521,1)==KM_PASS);   /* keypad number codes */
 assert(key(&k,1100,1)==KM_LEARNED);assert(k.learning==0);
 assert(key(&k,1100,2)==KM_DROP);assert(key(&k,1100,0)==KM_DROP);
 assert(key(&k,1100,1)==KM_PASS);assert(key(&k,1100,0)==KM_PASS); /* learned, not mapped */
 /* Cancel learning. */
 send(&k,"Ll");assert(key(&k,1100,1)==KM_PASS);key(&k,1100,0);
 /* Mapping: press reported once, rest swallowed. */
 send(&k,"M1100M0412M0773");assert(k.count==1);                   /* protected codes refused */
 assert(key(&k,1100,1)==KM_MAPPED);assert(key(&k,1100,2)==KM_DROP);assert(key(&k,1100,0)==KM_DROP);
 /* A key held before it was mapped is still released to webOS. */
 assert(key(&k,1101,1)==KM_PASS);send(&k,"M1101");
 assert(key(&k,1101,2)==KM_PASS);assert(key(&k,1101,0)==KM_PASS);
 assert(key(&k,1101,1)==KM_MAPPED);
 /* Cleared while held: the swallowed press is still swallowed to its release. */
 send(&k,"C");assert(key(&k,1101,0)==KM_DROP);assert(key(&k,1101,1)==KM_PASS);key(&k,1101,0);
 /* Commands split across reads, interrupted numbers, duplicates, limit. */
 send(&k,"M11");send(&k,"02");assert(k.count==1&&k.codes[0]==1102);
 send(&k,"M1x");assert(k.count==1);send(&k,"M1102");assert(k.count==1);
 send(&k,"C");char m[6];for(int i=0;i<20;i++){snprintf(m,sizeof m,"M%04d",1200+i);send(&k,m);}assert(k.count==KEYMAP_MAX);
 /* Non-key events always pass. */
 struct ev rel={0,0,2,0,5};assert(keymap_event(&k,&rel)==KM_PASS);
 puts("PASS: learning, protected keys, mapping, held keys, commands");
}
