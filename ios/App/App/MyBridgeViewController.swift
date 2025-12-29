import UIKit
import Capacitor

class MyBridgeViewController: CAPBridgeViewController {
    
    override open func capacitorDidLoad() {
        NSLog("[MyBridgeViewController] capacitorDidLoad - registering OfflineAsrPlugin")
        bridge?.registerPluginInstance(OfflineAsrPlugin())
    }
}

