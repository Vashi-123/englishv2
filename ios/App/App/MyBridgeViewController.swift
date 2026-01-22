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
        CAPPluginMethod(name: "presentOfferCode", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "finishTransaction", returnType: CAPPluginReturnPromise)
    ]

    private var updateTask: Task<Void, Never>?

    override public func load() {
        if #available(iOS 15.0, *) {
            updateTask = Task {
                for await result in Transaction.updates {
                    do {
                        let transaction = try self.verify(result)
                        let receipt = self.loadReceipt()
                        
                        var offerCodeRefName: String? = nil
                        if transaction.offerType == .code {
                            offerCodeRefName = transaction.offerID
                        }
                        
                        let purchaseData: [String: Any] = [
                            "transactionId": transaction.id,
                            "productId": transaction.productID,
                            "purchaseDateMs": Int(transaction.purchaseDate.timeIntervalSince1970 * 1000),
                            "receiptData": (receipt as Any?) ?? NSNull(),
                            "offerCodeRefName": offerCodeRefName ?? NSNull()
                        ]
                        
                        self.notifyListeners("transactionUpdated", data: ["purchase": purchaseData])
                        NSLog("[NativeIap] Emitted transactionUpdated for: \(transaction.id)")
                    } catch {
                        NSLog("[NativeIap] Transaction update verification failed: \(error.localizedDescription)")
                    }
                }
            }
        }
    }
    
    deinit {
        updateTask?.cancel()
    }

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
                        "currency": p.priceFormatStyle.currencyCode,
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
                    // REMOVED: await transaction.finish() - We wait for JS to finish it
                    
                    let receipt = self.loadReceipt()
                    
                    var offerCodeRefName: String? = nil
                    if transaction.offerType == .code {
                        offerCodeRefName = transaction.offerID
                    }
                    
                    let purchaseData: [String: Any] = [
                        "transactionId": transaction.id,
                        "productId": transaction.productID,
                        "purchaseDateMs": Int(transaction.purchaseDate.timeIntervalSince1970 * 1000),
                        "receiptData": (receipt as Any?) ?? NSNull(),
                        "offerCodeRefName": offerCodeRefName ?? NSNull()
                    ]
                    
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
            for await result in Transaction.currentEntitlements {
                if case .verified(let transaction) = result {
                    let receipt = self.loadReceipt()
                    
                    var offerCodeRefName: String? = nil
                    if transaction.offerType == .code {
                        offerCodeRefName = transaction.offerID
                    }
                    
                    call.resolve([
                        "purchase": [
                            "transactionId": transaction.id,
                            "productId": transaction.productID,
                            "purchaseDateMs": Int(transaction.purchaseDate.timeIntervalSince1970 * 1000),
                            "receiptData": (receipt as Any?) ?? NSNull(),
                            "offerCodeRefName": offerCodeRefName ?? NSNull()
                        ]
                    ])
                    // REMOVED: await transaction.finish()
                    return
                }
            }
            call.resolve(["purchase": NSNull()])
        }
    }
    
    @objc func finishTransaction(_ call: CAPPluginCall) {
        guard let transactionId = call.getString("transactionId") else {
            call.reject("Missing transactionId")
            return
        }
        
        if #available(iOS 15.0, *) {
            Task {
                // We cannot fetch a specific transaction by ID easily in StoreKit 2 without iterating/checking history
                // or keeping a reference. However, for 'finish', we can usually assume if we have the ID,
                // we might need to find it again.
                // NOTE: StoreKit 2 Transaction.finish() is an instance method.
                // We typically need the Transaction object.
                // A workaround is to define it:
                // But wait, we can't instantiate a Transaction from ID easily in public API?
                // Actually, we can iterate Transaction.unfinished?
                
                var found = false
                for await result in Transaction.unfinished {
                    if case .verified(let transaction) = result {
                        if String(transaction.id) == transactionId || String(transaction.originalID) == transactionId {
                             await transaction.finish()
                             found = true
                             // Keep going? Usually one ID matches one.
                             break
                        }
                    }
                }
                
                if found {
                    call.resolve()
                } else {
                     // Check verified/current entitlements just in case?
                     // If it's not in unfinished, maybe it's already finished.
                     call.resolve() // Treat as success to avoid blocking
                }
            }
        } else {
            call.reject("StoreKit 2 required")
        }
    }

    @objc func presentOfferCode(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if #available(iOS 14.0, *) {
                if #available(iOS 16.0, *) {
                    Task { @MainActor in
                        do {
                            guard let windowScene = UIApplication.shared.connectedScenes
                                .first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene
                                ?? UIApplication.shared.connectedScenes.first as? UIWindowScene else {
                                call.reject("No active window scene found")
                                return
                            }
                            try await AppStore.presentOfferCodeRedeemSheet(in: windowScene)
                            call.resolve([:])
                        } catch {
                            NSLog("[NativeIap] presentOfferCodeRedeemSheet error: %@", error.localizedDescription)
                            call.reject("Failed to present offer code sheet: \(error.localizedDescription)")
                        }
                    }
                } else {
                    SKPaymentQueue.default().presentCodeRedemptionSheet()
                    call.resolve([:])
                }
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
        // Transaction listener moved to NativeIapPlugin.load()
    }
    
    deinit {
        // No tasks to cancel here anymore
    }

    // Убираем стандартный accessory bar (Prev/Next/Done), чтобы не плодить auto-layout warnings
    override var inputAccessoryView: UIView? { nil }
    override var canBecomeFirstResponder: Bool { true }
}
