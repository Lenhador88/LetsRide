import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    // MARK: - APNs

    /**
     The two halves of the APNs answer, forwarded to `@capacitor/push-notifications`.

     **These are the only route from iOS to the plugin, and their absence is
     silent.** `PushNotificationsPlugin.load()` (8.1.2, `PushNotificationsPlugin.swift:38`)
     subscribes to `.capacitorDidRegisterForRemoteNotifications` and nothing
     else; iOS delivers the token to the *app delegate*, so with no post here
     `PushNotifications.register()` still resolves, `registerForRemoteNotifications()`
     still runs, and the `registration` listener in
     `src/lib/push/registration.ts` waits for ever. That is exactly the state
     `pushPrimingState` calls `stalled` — granted, registered, no token — and
     until this file existed it was the only outcome a device could reach.

     They stay on `UIApplicationDelegate` even though this app uses a
     `SceneDelegate`: remote-notification registration is an application-level
     callback and UIKit has no scene equivalent, so moving them would silence
     them again.

     Both post unconditionally rather than checking a flag first. The plugin
     records which of the two arrived and rejects `getDeliveredNotifications`
     and its siblings with a named error when neither did, so a failure that
     reaches here is reported rather than swallowed.
     */
    func application(_ application: UIApplication,
                     didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications,
                                        object: deviceToken)
    }

    func application(_ application: UIApplication,
                     didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications,
                                        object: error)
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}
