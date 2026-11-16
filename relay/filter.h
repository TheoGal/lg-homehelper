#include <stdint.h>
struct ev {uint32_t sec,usec;uint16_t type,code;int32_t value;};
struct filter {int home,short_press,count,disabled;uint64_t since,last,taps[3];};
enum action {PASS,OPEN_HOME,DROP,RELEASE};
int filter_event(struct filter*,const struct ev*,uint64_t);
int filter_timeout(struct filter*,uint64_t);
/* Remote buttons: learning a button and opening an app for mapped buttons.
 * Only presses the relay swallowed from the start are swallowed to the end,
 * so a key already held when a mapping changes is still released to webOS. */
#define KEYMAP_MAX 16
#define KEYMAP_CODES 4096
struct keymap {int learning,count,pending,digits,value;uint16_t codes[KEYMAP_MAX];unsigned char swallowed[KEYMAP_CODES/8];};
enum keymap_action {KM_PASS,KM_DROP,KM_LEARNED,KM_MAPPED};
int keymap_learnable(unsigned code);
int keymap_event(struct keymap*,const struct ev*);
/* Commands from the helper, one byte at a time: L learn, l cancel learning,
 * C clear mappings, M followed by four digits adds a mapped code. */
void keymap_command(struct keymap*,char);
