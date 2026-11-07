// Run a JS file inside a WKWebView at a given size and print its result.
//   clang -fobjc-arc -framework Cocoa -framework WebKit -o webkit-eval webkit-eval.m
//   webkit-eval <url> <width> <height> <script.js>
// The script's last expression is returned (wrap in an async IIFE and return a promise if needed).
// It sees the size as STATE_WIDTH and STATE_HEIGHT.
// Objective-C rather than Swift: clang always matches its SDK, while the Command Line Tools'
// swiftc can refuse the SDK's Swift modules after a partial update ("not supported by the
// compiler"), which took this check down on one Mac.
#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>

static void finish(NSString *line, int code) {
    printf("%s\n", line.UTF8String);
    fflush(stdout);
    exit(code);
}

@interface Delegate : NSObject <WKNavigationDelegate>
@property(strong) NSString *script;
@property double width, height;
@end

@implementation Delegate
- (void)webView:(WKWebView *)web didFailNavigation:(WKNavigation *)navigation withError:(NSError *)error {
    finish([NSString stringWithFormat:@"load failed: %@", error], 1);
}
- (void)webView:(WKWebView *)web didFailProvisionalNavigation:(WKNavigation *)navigation withError:(NSError *)error {
    finish([NSString stringWithFormat:@"load failed: %@", error], 1);
}
- (void)webView:(WKWebView *)web didFinishNavigation:(WKNavigation *)navigation {
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(1.2 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        [web callAsyncJavaScript:self.script
                       arguments:@{@"STATE_WIDTH": @(self.width), @"STATE_HEIGHT": @(self.height)}
                         inFrame:nil
                  inContentWorld:WKContentWorld.pageWorld
               completionHandler:^(id result, NSError *error) {
                   if (error) {
                       finish([NSString stringWithFormat:@"JS error: %@", error], 1);
                   }
                   finish([NSString stringWithFormat:@"%@", result], 0);
               }];
    });
}
@end

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc < 5) {
            finish(@"usage: webkit-eval <url> <width> <height> <script.js>", 2);
        }
        NSString *url = @(argv[1]);
        double width = atof(argv[2]), height = atof(argv[3]);
        NSError *readError = nil;
        NSString *script = [NSString stringWithContentsOfFile:@(argv[4]) encoding:NSUTF8StringEncoding error:&readError];
        if (!script) {
            finish([NSString stringWithFormat:@"cannot read script: %@", readError], 2);
        }

        NSApplication *app = NSApplication.sharedApplication;
        WKWebView *web = [[WKWebView alloc] initWithFrame:NSMakeRect(0, 0, width, height)];
        NSWindow *window = [[NSWindow alloc] initWithContentRect:web.frame
                                                       styleMask:NSWindowStyleMaskTitled
                                                         backing:NSBackingStoreBuffered
                                                           defer:NO];
        window.contentView = web;
        // On screen, not just created: a window WebKit thinks is hidden pauses requestAnimationFrame.
        [window orderFront:nil];

        // Never hang a CI job: give up after five minutes, and on any failed page load.
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(300 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
            finish(@"timeout: no result in 300 s", 1);
        });

        Delegate *delegate = [Delegate new];
        delegate.script = script;
        delegate.width = width;
        delegate.height = height;
        web.navigationDelegate = delegate;
        [web loadRequest:[NSURLRequest requestWithURL:[NSURL URLWithString:url]]];
        [app run];
    }
    return 0;
}
