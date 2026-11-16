#include "filter.h"
int filter_event(struct filter*f,const struct ev*e,uint64_t now){
 if(e->type==0&&e->code==3)return RELEASE;
 if(e->type!=1)return PASS;
 if(now<f->last){f->home=0;f->short_press=0;f->count=0;}
 f->last=now;
 /* Cursor-show notifications are not physical button presses. */
 if(e->code==1198)return PASS;
 if(e->code==773&&f->disabled)return PASS;
 if(e->code!=773){if(e->value){f->short_press=0;f->count=0;}return PASS;}
 if(e->value==1){
  int held=f->home;
  if(held)f->count=0;
  f->home=1;f->short_press=1;f->since=now;
  return held?DROP:OPEN_HOME;
 }
 if(e->value==2){f->short_press=0;f->count=0;return DROP;}
 if(e->value==0){
  int valid=f->home&&f->short_press&&now-f->since>=40&&now-f->since<=500;
  f->home=0;f->short_press=0;
  if(!valid){f->count=0;return DROP;}
  int kept=0;
  for(int i=0;i<f->count;i++)if(now-f->taps[i]<=2000)f->taps[kept++]=f->taps[i];
  f->taps[kept++]=f->since;f->count=kept;
  if(kept==3){f->count=0;return RELEASE;}
 }
 return DROP;
}
/* Holding Back is left entirely to webOS (newer TVs use it for accessibility
 * zoom). The helper only reports Back presses so it can tell a quick exit
 * from a deliberate one; it never acts on a held Back itself. */
int filter_timeout(struct filter*f,uint64_t now){(void)f;(void)now;return 0;}

/* Never learnable or mappable: Home, Back, OK, arrows, pointer buttons and
 * cursor, volume, mute, channel, number keys (both kinds of codes), the four
 * coloured (teletext) keys, power and the reserved code 0. */
int keymap_learnable(unsigned code){
 if(code==0||code>=KEYMAP_CODES)return 0;
 if(code>=2&&code<=11)return 0;                 /* number keys */
 if(code>=512&&code<=521)return 0;              /* number keys, keypad codes */
 if(code>=398&&code<=401)return 0;              /* red, green, yellow, blue */
 if(code>=272&&code<=287)return 0;              /* pointer buttons */
 static const unsigned blocked[]={773,412,1198,1199,28,352,103,105,106,108,113,114,115,116,402,403,1};
 for(unsigned i=0;i<sizeof blocked/sizeof blocked[0];i++)if(code==blocked[i])return 0;
 return 1;
}
static int mapped(const struct keymap*k,unsigned code){for(int i=0;i<k->count;i++)if(k->codes[i]==code)return 1;return 0;}
static int swallowed(const struct keymap*k,unsigned code){return k->swallowed[code/8]&(1<<(code%8));}
static void swallow(struct keymap*k,unsigned code,int on){if(on)k->swallowed[code/8]|=1<<(code%8);else k->swallowed[code/8]&=~(1<<(code%8));}
int keymap_event(struct keymap*k,const struct ev*e){
 if(e->type!=1||!keymap_learnable(e->code))return KM_PASS;
 unsigned code=e->code;
 if(e->value==1){
  if(k->learning){k->learning=0;swallow(k,code,1);return KM_LEARNED;}
  if(mapped(k,code)){swallow(k,code,1);return KM_MAPPED;}
  return KM_PASS;
 }
 if(!swallowed(k,code))return KM_PASS;
 if(e->value==0)swallow(k,code,0);
 return KM_DROP;
}
void keymap_command(struct keymap*k,char c){
 if(k->pending){
  if(c<'0'||c>'9'){k->pending=0;}
  else{k->value=k->value*10+(c-'0');if(++k->digits<4)return;
   k->pending=0;
   if(keymap_learnable(k->value)&&!mapped(k,k->value)&&k->count<KEYMAP_MAX)k->codes[k->count++]=k->value;
   return;}
 }
 if(c=='L')k->learning=1;
 else if(c=='l')k->learning=0;
 else if(c=='C')k->count=0;
 else if(c=='M'){k->pending=1;k->digits=0;k->value=0;}
}
