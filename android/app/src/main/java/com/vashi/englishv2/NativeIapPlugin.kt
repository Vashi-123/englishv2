package com.vashi.englishv2

import android.util.Log
import com.android.billingclient.api.*
import com.getcapacitor.*
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject

@CapacitorPlugin(name = "NativeIap")
class NativeIapPlugin : Plugin() {

    private val TAG = "NativeIap"
    private var billingClient: BillingClient? = null
    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    
    // Pending calls waiting for billing client connection
    private val pendingCalls = mutableListOf<() -> Unit>()
    private var isConnecting = false

    override fun load() {
        super.load()
        Log.d(TAG, "NativeIapPlugin loaded")
        initializeBillingClient()
    }

    private fun initializeBillingClient() {
        billingClient = BillingClient.newBuilder(context)
            .setListener { billingResult, purchases ->
                // Handle purchases updated - this is called for new purchases
                Log.d(TAG, "onPurchasesUpdated: ${billingResult.responseCode}")
                if (billingResult.responseCode == BillingClient.BillingResponseCode.OK && purchases != null) {
                    for (purchase in purchases) {
                        Log.d(TAG, "Purchase: ${purchase.orderId}, state: ${purchase.purchaseState}")
                    }
                }
            }
            .enablePendingPurchases()
            .build()
    }

    private fun ensureConnected(onConnected: () -> Unit) {
        val client = billingClient ?: run {
            Log.e(TAG, "BillingClient is null")
            return
        }

        when {
            client.isReady -> {
                onConnected()
            }
            isConnecting -> {
                pendingCalls.add(onConnected)
            }
            else -> {
                isConnecting = true
                pendingCalls.add(onConnected)
                
                client.startConnection(object : BillingClientStateListener {
                    override fun onBillingSetupFinished(billingResult: BillingResult) {
                        isConnecting = false
                        if (billingResult.responseCode == BillingClient.BillingResponseCode.OK) {
                            Log.d(TAG, "Billing client connected")
                            pendingCalls.forEach { it() }
                            pendingCalls.clear()
                        } else {
                            Log.e(TAG, "Billing setup failed: ${billingResult.debugMessage}")
                            pendingCalls.clear()
                        }
                    }

                    override fun onBillingServiceDisconnected() {
                        Log.w(TAG, "Billing service disconnected")
                        isConnecting = false
                    }
                })
            }
        }
    }

    @PluginMethod
    fun getProducts(call: PluginCall) {
        val productIds = call.getArray("productIds")
        if (productIds == null || productIds.length() == 0) {
            call.resolve(JSObject().put("products", JSArray()))
            return
        }

        ensureConnected {
            val productList = mutableListOf<QueryProductDetailsParams.Product>()
            for (i in 0 until productIds.length()) {
                val productId = productIds.getString(i)
                productList.add(
                    QueryProductDetailsParams.Product.newBuilder()
                        .setProductId(productId)
                        .setProductType(BillingClient.ProductType.INAPP)
                        .build()
                )
            }

            val params = QueryProductDetailsParams.newBuilder()
                .setProductList(productList)
                .build()

            billingClient?.queryProductDetailsAsync(params) { billingResult, productDetailsList ->
                if (billingResult.responseCode == BillingClient.BillingResponseCode.OK) {
                    val productsArray = JSArray()
                    for (product in productDetailsList) {
                        val oneTimePurchaseOfferDetails = product.oneTimePurchaseOfferDetails
                        val productObj = JSObject()
                        productObj.put("productId", product.productId)
                        productObj.put("title", product.title)
                        productObj.put("description", product.description)
                        
                        if (oneTimePurchaseOfferDetails != null) {
                            // Price in micros (e.g., 1490000000 for 1490 RUB)
                            val priceAmountMicros = oneTimePurchaseOfferDetails.priceAmountMicros
                            val priceValue = priceAmountMicros / 1_000_000.0
                            productObj.put("price", priceValue.toString())
                            productObj.put("currency", oneTimePurchaseOfferDetails.priceCurrencyCode)
                            productObj.put("localizedPrice", oneTimePurchaseOfferDetails.formattedPrice)
                        }
                        
                        productsArray.put(productObj)
                    }
                    call.resolve(JSObject().put("products", productsArray))
                } else {
                    Log.e(TAG, "getProducts failed: ${billingResult.debugMessage}")
                    call.reject("Failed to get products: ${billingResult.debugMessage}")
                }
            }
        }
    }

    @PluginMethod
    fun purchase(call: PluginCall) {
        val productId = call.getString("productId")
        if (productId.isNullOrEmpty()) {
            call.reject("Missing productId")
            return
        }

        ensureConnected {
            val productList = listOf(
                QueryProductDetailsParams.Product.newBuilder()
                    .setProductId(productId)
                    .setProductType(BillingClient.ProductType.INAPP)
                    .build()
            )

            val params = QueryProductDetailsParams.newBuilder()
                .setProductList(productList)
                .build()

            billingClient?.queryProductDetailsAsync(params) { billingResult, productDetailsList ->
                if (billingResult.responseCode != BillingClient.BillingResponseCode.OK || productDetailsList.isEmpty()) {
                    call.reject("Product not found: $productId")
                    return@queryProductDetailsAsync
                }

                val productDetails = productDetailsList[0]
                
                val productDetailsParams = BillingFlowParams.ProductDetailsParams.newBuilder()
                    .setProductDetails(productDetails)
                    .build()

                val billingFlowParams = BillingFlowParams.newBuilder()
                    .setProductDetailsParamsList(listOf(productDetailsParams))
                    .build()

                // Store the call to resolve when purchase completes
                savedPurchaseCall = call

                activity?.let { activity ->
                    val launchResult = billingClient?.launchBillingFlow(activity, billingFlowParams)
                    if (launchResult?.responseCode != BillingClient.BillingResponseCode.OK) {
                        savedPurchaseCall = null
                        call.reject("Failed to launch purchase flow: ${launchResult?.debugMessage}")
                    }
                } ?: run {
                    savedPurchaseCall = null
                    call.reject("Activity not available")
                }
            }
        }
    }

    // Store pending purchase call
    private var savedPurchaseCall: PluginCall? = null

    // Called from BillingClient listener when purchase is updated
    private fun handlePurchaseUpdate(purchases: List<Purchase>?) {
        val call = savedPurchaseCall ?: return
        savedPurchaseCall = null

        if (purchases.isNullOrEmpty()) {
            call.reject("CANCELLED")
            return
        }

        val purchase = purchases[0]
        
        when (purchase.purchaseState) {
            Purchase.PurchaseState.PURCHASED -> {
                // Acknowledge the purchase if not consumed
                if (!purchase.isAcknowledged) {
                    acknowledgePurchase(purchase) { success ->
                        if (success) {
                            resolvePurchase(call, purchase)
                        } else {
                            call.reject("Failed to acknowledge purchase")
                        }
                    }
                } else {
                    resolvePurchase(call, purchase)
                }
            }
            Purchase.PurchaseState.PENDING -> {
                call.reject("PENDING")
            }
            else -> {
                call.reject("Unknown purchase state: ${purchase.purchaseState}")
            }
        }
    }

    private fun resolvePurchase(call: PluginCall, purchase: Purchase) {
        val purchaseData = JSObject()
        purchaseData.put("orderId", purchase.orderId ?: "")
        purchaseData.put("purchaseToken", purchase.purchaseToken)
        purchaseData.put("purchaseDateMs", purchase.purchaseTime)
        purchaseData.put("productId", purchase.products.firstOrNull() ?: "")
        
        val result = JSObject()
        result.put("purchase", purchaseData)
        call.resolve(result)
    }

    private fun acknowledgePurchase(purchase: Purchase, callback: (Boolean) -> Unit) {
        val acknowledgePurchaseParams = AcknowledgePurchaseParams.newBuilder()
            .setPurchaseToken(purchase.purchaseToken)
            .build()

        billingClient?.acknowledgePurchase(acknowledgePurchaseParams) { billingResult ->
            callback(billingResult.responseCode == BillingClient.BillingResponseCode.OK)
        }
    }

    @PluginMethod
    fun restorePurchases(call: PluginCall) {
        ensureConnected {
            val params = QueryPurchasesParams.newBuilder()
                .setProductType(BillingClient.ProductType.INAPP)
                .build()

            billingClient?.queryPurchasesAsync(params) { billingResult, purchasesList ->
                if (billingResult.responseCode == BillingClient.BillingResponseCode.OK) {
                    // Find the first valid (purchased) purchase
                    val validPurchase = purchasesList.firstOrNull { 
                        it.purchaseState == Purchase.PurchaseState.PURCHASED 
                    }

                    if (validPurchase != null) {
                        val purchaseData = JSObject()
                        purchaseData.put("orderId", validPurchase.orderId ?: "")
                        purchaseData.put("purchaseToken", validPurchase.purchaseToken)
                        purchaseData.put("purchaseDateMs", validPurchase.purchaseTime)
                        purchaseData.put("productId", validPurchase.products.firstOrNull() ?: "")
                        
                        val result = JSObject()
                        result.put("purchase", purchaseData)
                        call.resolve(result)
                    } else {
                        // No purchases found
                        val result = JSObject()
                        result.put("purchase", JSONObject.NULL)
                        call.resolve(result)
                    }
                } else {
                    call.reject("Failed to query purchases: ${billingResult.debugMessage}")
                }
            }
        }
    }

    override fun handleOnDestroy() {
        super.handleOnDestroy()
        scope.cancel()
        billingClient?.endConnection()
        billingClient = null
    }
}
