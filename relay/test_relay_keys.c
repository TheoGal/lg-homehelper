/* App buttons through the whole relay: a learned press and a mapped press
 * are reported (LEARN/KEY) and never re-emitted to webOS; other keys still
 * are; Home keeps working; commands arrive one byte per read. */
#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <sys/ioctl.h>
#include <time.h>
#include <errno.h>
#include <string.h>
#include <stdarg.h>
#include <assert.h>
#ifndef _IOC_READ
#define _IOC_READ IOC_OUT
#endif
static int fake_open(const char*,int,...),fake_close(int),fake_ioctl(int,unsigned long,...),fake_poll(struct pollfd*,nfds_t,int),fake_clock(clockid_t,struct timespec*),fake_flock(int,int);
static ssize_t fake_read(int,void*,size_t),fake_write(int,const void*,size_t);
#define open fake_open
#define close fake_close
#define ioctl fake_ioctl
#define poll fake_poll
#define clock_gettime fake_clock
#define flock fake_flock
#define read fake_read
#define write fake_write
#define main relay_main
#include "relay.c"
#undef main
static uint64_t now;static int grabbed,step;static char pending;
static char out[4096];static size_t outlen;
static int emitted[4096];
/* {'c',char}: controller byte on stdin. {code,value}: M-RCU key event. */
static const int script[][2]={
 {'c','L'},{1300,1},{1300,0},          /* learning: 1300 is learned, swallowed */
 {1300,1},{1300,0},                    /* learned only: passes again */
 {'c','M'},{'c','1'},{'c','3'},{'c','0'},{'c','0'},
 {1300,1},{1300,2},{1300,0},           /* mapped: reported once, swallowed */
 {1400,1},{1400,0},                    /* unmapped key passes */
 {773,1},{773,0},                      /* Home still reported */
 {'c','C'},{1300,1},{1300,0}};         /* cleared: passes again */
#define STEPS ((int)(sizeof script/sizeof script[0]))
static int fake_open(const char*p,int flags,...){(void)flags;if(strstr(p,"relay.lock"))return 3;if(strstr(p,"/blocked")||strstr(p,"/watchdog"))return 4;
 if(!strcmp(p,"/dev/input/event0"))return 10;if(!strcmp(p,"/dev/input/event1"))return 11;errno=ENOENT;return -1;}
static int fake_close(int fd){(void)fd;return 0;}
static int fake_flock(int fd,int flags){(void)fd;(void)flags;return 0;}
static int fake_clock(clockid_t id,struct timespec*t){(void)id;t->tv_sec=now/1000;t->tv_nsec=(now%1000)*1000000;return 0;}
static int fake_ioctl(int fd,unsigned long request,...){
 va_list a;va_start(a,request);
 if(request==GRAB){int on=va_arg(a,int);va_end(a);if(fd==10)grabbed=on;return 0;}
 void*b=va_arg(a,void*);va_end(a);
 if(request==NAME(256)){strcpy(b,fd==10?"LGE M-RCU - Builtin [0]":"LGE M-RCU - Builtin [1]");return 0;}
 memset(b,0,request==_IOR('E',0x40,int[6])||request==_IOR('E',0x41,int[6])?sizeof(int)*6:256);return 0;
}
static int fake_poll(struct pollfd*p,nfds_t n,int timeout){(void)timeout;if(n==1){now+=50;p->revents=POLLIN;pending='P';return 1;}
 now+=100;p[0].revents=0;p[1].revents=POLLIN;p[2].revents=0;pending='P';
 if(step>=STEPS){stop=1;return 1;}if(!grabbed)return 1;
 if(script[step][0]=='c'){pending=(char)script[step][1];step++;return 1;}
 p[0].revents=POLLIN;return 1;}
static ssize_t fake_read(int fd,void*b,size_t size){(void)size;if(fd==0){*(char*)b=pending;return 1;}
 if(fd==10&&grabbed&&step<STEPS&&script[step][0]!='c'){struct ev e={0,0,1,(uint16_t)script[step][0],script[step][1]};step++;memcpy(b,&e,sizeof e);return sizeof e;}
 errno=EAGAIN;return -1;}
static ssize_t fake_write(int fd,const void*b,size_t size){
 if(fd==1&&outlen+size<sizeof out){memcpy(out+outlen,b,size);outlen+=size;}
 if(fd==11){const struct ev*e=b;for(size_t i=0;i<size/sizeof*e;i++)if(e[i].type==1&&e[i].code<4096)emitted[e[i].code]++;}
 return (ssize_t)size;}
int main(void){
 char*args[]={"relay",NULL};
 assert(relay_main(1,args)==0);assert(step==STEPS);
 out[outlen]=0;
 assert(strstr(out,"LEARN 1300\n"));
 assert(strstr(out,"KEY 1300\n")&&!strstr(strstr(out,"KEY 1300\n")+1,"KEY 1300"));
 assert(strstr(out,"HOME\n"));
 /* 1300 reached webOS only while learned-not-mapped and after clearing: 2 presses x (down, up). */
 assert(emitted[1300]==4);
 assert(emitted[1400]==2);
 assert(emitted[773]==0);
 puts("PASS: learned and mapped presses reported and swallowed; other keys and Home unchanged");
}
