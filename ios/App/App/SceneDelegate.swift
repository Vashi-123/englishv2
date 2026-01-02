import UIKit
import Capacitor

// ОПТИМИЗАЦИЯ: SceneDelegate для поддержки UIScene lifecycle (iOS 13+)
// Это устраняет предупреждение и улучшает производительность запуска
@available(iOS 13.0, *)
@objc(SceneDelegate)
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = (scene as? UIWindowScene) else { return }
        
        // ОПТИМИЗАЦИЯ: Создаем окно и устанавливаем rootViewController для Capacitor
        window = UIWindow(windowScene: windowScene)
        
        // КРИТИЧНО: Capacitor требует явной установки rootViewController
        // Используем Main.storyboard для загрузки MyBridgeViewController
        let storyboard = UIStoryboard(name: "Main", bundle: nil)
        if let viewController = storyboard.instantiateInitialViewController() {
            window?.rootViewController = viewController
            window?.makeKeyAndVisible()
        } else {
            // Fallback: создаем MyBridgeViewController напрямую
            let bridgeViewController = MyBridgeViewController()
            window?.rootViewController = bridgeViewController
            window?.makeKeyAndVisible()
        }
    }

    func sceneDidDisconnect(_ scene: UIScene) {
        // Очистка ресурсов при отключении сцены
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        // Приложение стало активным
    }

    func sceneWillResignActive(_ scene: UIScene) {
        // Приложение скоро станет неактивным
    }

    func sceneWillEnterForeground(_ scene: UIScene) {
        // Приложение входит в foreground
    }

    func sceneDidEnterBackground(_ scene: UIScene) {
        // Приложение вошло в background
    }
}

