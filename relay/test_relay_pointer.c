/* The emergency stop with the Magic Remote's pointer (Home shows it): the remote
 * sends "pointer shown" (1198) in the same batch as each Home release, and the
 * third release ends the relay mid-batch. Before handing the remote back,
 * webOS's pointer state must match the remote's (1198 shown), or the pointer
 * stays dead until a TV restart. Held buttons are still released, but never the
 * pointer state, also in the clean-up after a crash at the next start. */
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
static int held[2048];          /* key state of the relayed stream, as webOS sees it */
static int remote[2048];        /* key state of the remote itself */
static int released[2048];      /* key-up events written for each code */
/* Batches as the remote sends them: the pointer is showing and a button is
 * held, then three quick Home presses. A press hides the pointer, a release
 * shows it again in the same batch; the third release ends the relay. */
static const int script[][2][2]={{{1198,1},{0,0}},{{1400,1},{0,0}},
 {{773,1},{1198,0}},{{773,0},{1198,1}},{{773,1},{1198,0}},{{773,0},{1198,1}},{{773,1},{1198,0}},{{773,0},{1198,1}}};
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
 if(request==KEYSTATE(256)){unsigned char*bits=b;memset(bits,0,256);int*st=fd==11?held:fd==10?remote:NULL;if(st)for(int k=0;k<2048;k++)if(st[k])bits[k/8]|=1<<(k%8);return 0;}
 memset(b,0,request==_IOR('E',0x40,int[6])||request==_IOR('E',0x41,int[6])?sizeof(int)*6:256);return 0;
}
static int fake_poll(struct pollfd*p,nfds_t n,int timeout){(void)timeout;if(n==1){now+=50;p->revents=POLLIN;pending='P';return 1;}
 now+=100;p[0].revents=0;p[1].revents=POLLIN;p[2].revents=0;pending='P';
 if(step>=STEPS){stop=1;return 1;}if(!grabbed)return 1;p[0].revents=POLLIN;return 1;}
static ssize_t fake_read(int fd,void*b,size_t size){(void)size;if(fd==0){*(char*)b=pending;return 1;}
 if(fd==10&&grabbed&&step<STEPS){struct ev e[2];int n=0;for(int j=0;j<2;j++)if(script[step][j][0]){e[n]=(struct ev){0,0,1,(uint16_t)script[step][j][0],script[step][j][1]};remote[script[step][j][0]]=script[step][j][1];n++;}step++;memcpy(b,e,n*sizeof e[0]);return n*sizeof e[0];}
 errno=EAGAIN;return -1;}
static ssize_t fake_write(int fd,const void*b,size_t size){
 if(fd==11){const struct ev*e=b;for(size_t i=0;i<size/sizeof*e;i++)if(e[i].type==1&&e[i].code<2048){if(e[i].value==0){released[e[i].code]++;held[e[i].code]=0;}else held[e[i].code]=1;}}
 return (ssize_t)size;}
int main(void){
 char*args[]={"relay",NULL};
 int code=relay_main(1,args);
 assert(code==27);                          /* the emergency stop */
 assert(released[1400]==1);                 /* a held button is still released */
 assert(remote[1198]==1);                   /* the remote counts the pointer as shown */
 assert(held[1198]==1);                     /* and so does webOS when it gets the remote back */
 /* Next start after a crash: clean-up of held keys leaves the pointer alone too. */
 memset(released,0,sizeof released);held[1500]=1;held[1198]=1;
 char*clean[]={"relay","--cleanup",NULL};
 if(release_keys(-1,11)<0)return 1;
 assert(released[1500]==1&&released[1198]==0);
 (void)clean;
 puts("PASS: emergency stop and clean-up release buttons but not the pointer state");
}
