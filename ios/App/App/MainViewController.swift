import UIKit
import Capacitor
import WebKit

/// 앱 내부 플러그인(CoachEngine)을 등록하고 웹뷰를 훈련 앱에 맞게 설정
class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(CoachEnginePlugin())
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 8 / 255, green: 10 / 255, blue: 13 / 255, alpha: 1)
        webView?.isOpaque = false
        webView?.backgroundColor = view.backgroundColor
        webView?.scrollView.backgroundColor = view.backgroundColor
        webView?.scrollView.bounces = false
        webView?.allowsLinkPreview = false
        if #available(iOS 16.4, *) {
            webView?.isInspectable = true
        }
    }

    override var preferredStatusBarStyle: UIStatusBarStyle {
        return .lightContent
    }
}
