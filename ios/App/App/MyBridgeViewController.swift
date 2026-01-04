import UIKit
import Capacitor
import AuthenticationServices
import StoreKit

@objc(AuthSessionPlugin)
public class AuthSessionPlugin: CAPPlugin, CAPBridgedPlugin, ASWebAuthenticationPresentationContextProviding {
    public let identifier = "AuthSessionPlugin"
    public let jsName = "AuthSession"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise)
    ]
    private var session: ASWebAuthenticationSession?

    @objc func open(_ call: CAPPluginCall) {
        guard let urlString = call.getString("url"), let url = URL(string: urlString) else {
            call.reject("Invalid URL")
            return
        }
        guard let scheme = call.getString("callbackScheme"), !scheme.isEmpty else {
            call.reject("Missing callbackScheme")
            return
        }

        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: scheme) { callbackURL, error in
                self.session = nil
                if let error = error as? ASWebAuthenticationSessionError, error.code == .canceledLogin {
                    call.reject("CANCELLED")
                    return
                }
                if let error = error {
                    call.reject(error.localizedDescription)
                    return
                }
                call.resolve([
                    "url": callbackURL?.absoluteString ?? ""
                ])
            }
            session.prefersEphemeralWebBrowserSession = false // share Safari cookies
            session.presentationContextProvider = self
            self.session = session
            if !session.start() {
                self.session = nil
                call.reject("Unable to start auth session")
            }
        }
    }

    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        return self.bridge?.viewController?.view.window ?? ASPresentationAnchor()
    }
}

@objc(NativeIapPlugin)
public class NativeIapPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeIapPlugin"
    public let jsName = "NativeIap"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getProducts", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "purchase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restorePurchases", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "presentOfferCode", returnType: CAPPluginReturnPromise)
    ]

    private func loadReceipt() -> String? {
        guard let url = Bundle.main.appStoreReceiptURL else { return nil }
        guard let data = try? Data(contentsOf: url) else { return nil }
        return data.base64EncodedString()
    }

    @objc func getProducts(_ call: CAPPluginCall) {
        let ids = call.getArray("productIds", String.self) ?? []
        if ids.isEmpty {
            call.resolve(["products": []])
            return
        }
        Task {
            do {
                let products = try await Product.products(for: ids)
                let mapped = products.map { p -> [String: Any] in
                    [
                        "productId": p.id,
                        "price": p.price.description,
                        "currency": p.priceFormatStyle.currencyCode ?? "",
                        "localizedPrice": p.displayPrice
                    ]
                }
                call.resolve(["products": mapped])
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc func purchase(_ call: CAPPluginCall) {
        guard let productId = call.getString("productId") else {
            call.reject("Missing productId")
            return
        }
        Task {
            do {
                let products = try await Product.products(for: [productId])
                guard let product = products.first else {
                    call.reject("Product not found")
                    return
                }
                let result = try await product.purchase()
                switch result {
                case .success(let verification):
                    let transaction = try self.verify(verification)
                    await transaction.finish()
                    let receipt = self.loadReceipt()
                    // Note: offerCodeRefName is not directly available in StoreKit 2 Transaction
                    // Promo codes are applied automatically by Apple and can be extracted from receipt
                    // via App Store Server API on the server side
                    var purchaseData: [String: Any] = [
                        "transactionId": transaction.id,
                        "purchaseDateMs": Int(transaction.purchaseDate.timeIntervalSince1970 * 1000),
                        "receiptData": receipt ?? NSNull()
                    ]
                    // Try to extract offerCodeRefName if available (may not be accessible in StoreKit 2)
                    // Server will parse receipt to extract promo code information
                    call.resolve([
                        "purchase": purchaseData
                    ])
                case .userCancelled:
                    call.reject("CANCELLED")
                case .pending:
                    call.reject("PENDING")
                @unknown default:
                    call.reject("Unknown purchase state")
                }
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc func restorePurchases(_ call: CAPPluginCall) {
        Task {
            do {
                for await result in Transaction.currentEntitlements {
                    if case .verified(let transaction) = result {
                        let receipt = self.loadReceipt()
                        call.resolve([
                            "purchase": [
                                "transactionId": transaction.id,
                                "purchaseDateMs": Int(transaction.purchaseDate.timeIntervalSince1970 * 1000),
                                "receiptData": receipt ?? NSNull()
                            ]
                        ])
                        await transaction.finish()
                        return
                    }
                }
                call.resolve(["purchase": NSNull()])
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc func presentOfferCode(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if #available(iOS 14.0, *) {
                SKPaymentQueue.default().presentCodeRedemptionSheet()
                call.resolve([:])
            } else {
                call.reject("Offer codes are only available on iOS 14.0 or later")
            }
        }
    }

    private func verify(_ result: VerificationResult<Transaction>) throws -> Transaction {
        switch result {
        case .unverified(_, let error):
            throw error
        case .verified(let transaction):
            return transaction
        }
    }
}

class MyBridgeViewController: CAPBridgeViewController {
    
    override open func capacitorDidLoad() {
        NSLog("[MyBridgeViewController] capacitorDidLoad - registering AuthSessionPlugin")
        bridge?.registerPluginInstance(AuthSessionPlugin())
        NSLog("[MyBridgeViewController] capacitorDidLoad - registering NativeIapPlugin")
        bridge?.registerPluginInstance(NativeIapPlugin())
    }

    // Убираем стандартный accessory bar (Prev/Next/Done), чтобы не плодить auto-layout warnings
    override var inputAccessoryView: UIView? { nil }
    override var canBecomeFirstResponder: Bool { true }
}
