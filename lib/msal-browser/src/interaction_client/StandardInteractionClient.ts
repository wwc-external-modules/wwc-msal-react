/*
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import { ICrypto, Logger, ServerTelemetryManager, CommonAuthorizationCodeRequest, Constants, AuthorizationCodeClient, ClientConfiguration, AuthorityOptions, Authority, AuthorityFactory, ServerAuthorizationCodeResponse, UrlString, CommonEndSessionRequest, ProtocolUtils, ResponseMode, StringUtils } from "@azure/msal-common";
import { BaseInteractionClient } from "./BaseInteractionClient";
import { BrowserConfiguration } from "../config/Configuration";
import { AuthorizationUrlRequest } from "../request/AuthorizationUrlRequest";
import { BrowserCacheManager } from "../cache/BrowserCacheManager";
import { EventHandler } from "../event/EventHandler";
import { BrowserConstants, InteractionType } from "../utils/BrowserConstants";
import { version } from "../packageMetadata";
import { BrowserAuthError } from "../error/BrowserAuthError";
import { BrowserProtocolUtils, BrowserStateObject } from "../utils/BrowserProtocolUtils";
import { EndSessionRequest } from "../request/EndSessionRequest";
import { BrowserUtils } from "../utils/BrowserUtils";
import { INavigationClient } from "../navigation/INavigationClient";
import { RedirectRequest } from "../request/RedirectRequest";
import { PopupRequest } from "../request/PopupRequest";
import { SsoSilentRequest } from "../request/SsoSilentRequest";

/**
 * Defines the class structure and helper functions used by the "standard", non-brokered auth flows (popup, redirect, silent (RT), silent (iframe))
 */
export abstract class StandardInteractionClient extends BaseInteractionClient {
    protected navigationClient: INavigationClient;

    constructor(config: BrowserConfiguration, storageImpl: BrowserCacheManager, browserCrypto: ICrypto, logger: Logger, eventHandler: EventHandler, navigationClient: INavigationClient, correlationId?: string) {
        super(config, storageImpl, browserCrypto, logger, eventHandler, correlationId);
        this.navigationClient = navigationClient;
    }
    
    /**
     * Generates an auth code request tied to the url request.
     * @param request
     */
    protected async initializeAuthorizationCodeRequest(request: AuthorizationUrlRequest): Promise<CommonAuthorizationCodeRequest> {
        this.logger.verbose("initializeAuthorizationRequest called", request.correlationId);
        const generatedPkceParams = await this.browserCrypto.generatePkceCodes();

        const authCodeRequest: CommonAuthorizationCodeRequest = {
            ...request,
            redirectUri: request.redirectUri,
            code: "",
            codeVerifier: generatedPkceParams.verifier
        };

        request.codeChallenge = generatedPkceParams.challenge;
        request.codeChallengeMethod = Constants.S256_CODE_CHALLENGE_METHOD;

        return authCodeRequest;
    }

    /**
     * Initializer for the logout request.
     * @param logoutRequest
     */
    protected initializeLogoutRequest(logoutRequest?: EndSessionRequest): CommonEndSessionRequest {
        this.logger.verbose("initializeLogoutRequest called", logoutRequest?.correlationId);

        // Check if interaction is in progress. Throw error if true.
        if (this.browserStorage.isInteractionInProgress()) {
            throw BrowserAuthError.createInteractionInProgressError();
        }

        const validLogoutRequest: CommonEndSessionRequest = {
            correlationId: this.browserCrypto.createNewGuid(),
            ...logoutRequest
        };

        /*
         * Only set redirect uri if logout request isn't provided or the set uri isn't null.
         * Otherwise, use passed uri, config, or current page.
         */
        if (!logoutRequest || logoutRequest.postLogoutRedirectUri !== null) {
            if (logoutRequest && logoutRequest.postLogoutRedirectUri) {
                this.logger.verbose("Setting postLogoutRedirectUri to uri set on logout request", validLogoutRequest.correlationId);
                validLogoutRequest.postLogoutRedirectUri = UrlString.getAbsoluteUrl(logoutRequest.postLogoutRedirectUri, BrowserUtils.getCurrentUri());
            } else if (this.config.auth.postLogoutRedirectUri === null) {
                this.logger.verbose("postLogoutRedirectUri configured as null and no uri set on request, not passing post logout redirect", validLogoutRequest.correlationId);
            } else if (this.config.auth.postLogoutRedirectUri) {
                this.logger.verbose("Setting postLogoutRedirectUri to configured uri", validLogoutRequest.correlationId);
                validLogoutRequest.postLogoutRedirectUri = UrlString.getAbsoluteUrl(this.config.auth.postLogoutRedirectUri, BrowserUtils.getCurrentUri());
            } else {
                this.logger.verbose("Setting postLogoutRedirectUri to current page", validLogoutRequest.correlationId);
                validLogoutRequest.postLogoutRedirectUri = UrlString.getAbsoluteUrl(BrowserUtils.getCurrentUri(), BrowserUtils.getCurrentUri());
            }
        } else {
            this.logger.verbose("postLogoutRedirectUri passed as null, not setting post logout redirect uri", validLogoutRequest.correlationId);
        }

        return validLogoutRequest;
    }

    /**
     * Creates an Authorization Code Client with the given authority, or the default authority.
     * @param serverTelemetryManager
     * @param authorityUrl
     */
    protected async createAuthCodeClient(serverTelemetryManager: ServerTelemetryManager, authorityUrl?: string): Promise<AuthorizationCodeClient> {
        // Create auth module.
        const clientConfig = await this.getClientConfiguration(serverTelemetryManager, authorityUrl);
        return new AuthorizationCodeClient(clientConfig);
    }

    /**
     * Creates a Client Configuration object with the given request authority, or the default authority.
     * @param serverTelemetryManager
     * @param requestAuthority
     * @param requestCorrelationId
     */
    protected async getClientConfiguration(serverTelemetryManager: ServerTelemetryManager, requestAuthority?: string): Promise<ClientConfiguration> {
        this.logger.verbose("getClientConfiguration called");
        const discoveredAuthority = await this.getDiscoveredAuthority(requestAuthority);

        return {
            authOptions: {
                clientId: this.config.auth.clientId,
                authority: discoveredAuthority,
                clientCapabilities: this.config.auth.clientCapabilities
            },
            systemOptions: {
                tokenRenewalOffsetSeconds: this.config.system.tokenRenewalOffsetSeconds,
                preventCorsPreflight: true
            },
            loggerOptions: {
                loggerCallback: this.config.system.loggerOptions.loggerCallback,
                piiLoggingEnabled: this.config.system.loggerOptions.piiLoggingEnabled,
                logLevel: this.config.system.loggerOptions.logLevel,
                correlationId: this.correlationId
            },
            cryptoInterface: this.browserCrypto,
            networkInterface: this.networkClient,
            storageInterface: this.browserStorage,
            serverTelemetryManager: serverTelemetryManager,
            libraryInfo: {
                sku: BrowserConstants.MSAL_SKU,
                version: version,
                cpu: "",
                os: ""
            }
        };
    }

    /**
     * @param hash
     * @param interactionType
     */
    protected validateAndExtractStateFromHash(hash: string, interactionType: InteractionType, requestCorrelationId?: string): string {
        this.logger.verbose("validateAndExtractStateFromHash called", requestCorrelationId);
        // Deserialize hash fragment response parameters.
        const serverParams: ServerAuthorizationCodeResponse = UrlString.getDeserializedHash(hash);
        if (!serverParams.state) {
            throw BrowserAuthError.createHashDoesNotContainStateError();
        }

        const platformStateObj = BrowserProtocolUtils.extractBrowserRequestState(this.browserCrypto, serverParams.state);
        if (!platformStateObj) {
            throw BrowserAuthError.createUnableToParseStateError();
        }

        if (platformStateObj.interactionType !== interactionType) {
            throw BrowserAuthError.createStateInteractionTypeMismatchError();
        }

        this.logger.verbose("Returning state from hash", requestCorrelationId);
        return serverParams.state;
    }

    /**
     * Used to get a discovered version of the default authority.
     * @param requestAuthority
     * @param requestCorrelationId
     */
    protected async getDiscoveredAuthority(requestAuthority?: string): Promise<Authority> {
        this.logger.verbose("getDiscoveredAuthority called");
        const authorityOptions: AuthorityOptions = {
            protocolMode: this.config.auth.protocolMode,
            knownAuthorities: this.config.auth.knownAuthorities,
            cloudDiscoveryMetadata: this.config.auth.cloudDiscoveryMetadata,
            authorityMetadata: this.config.auth.authorityMetadata
        };

        if (requestAuthority) {
            this.logger.verbose("Creating discovered authority with request authority");
            return await AuthorityFactory.createDiscoveredInstance(requestAuthority, this.config.system.networkClient, this.browserStorage, authorityOptions);
        }

        this.logger.verbose("Creating discovered authority with configured authority");
        return await AuthorityFactory.createDiscoveredInstance(this.config.auth.authority, this.config.system.networkClient, this.browserStorage, authorityOptions);
    }

    /**
     * Helper to validate app environment before making a request.
     * @param request
     * @param interactionType
     */
    protected preflightInteractiveRequest(request: RedirectRequest|PopupRequest, interactionType: InteractionType): AuthorizationUrlRequest {
        this.logger.verbose("preflightInteractiveRequest called, validating app environment", request?.correlationId);
        // block the reload if it occurred inside a hidden iframe
        BrowserUtils.blockReloadInHiddenIframes();
    
        // Check if interaction is in progress. Throw error if true.
        if (this.browserStorage.isInteractionInProgress(false)) {
            throw BrowserAuthError.createInteractionInProgressError();
        }
    
        return this.initializeAuthorizationRequest(request, interactionType);
    }

    /**
     * Helper to initialize required request parameters for interactive APIs and ssoSilent()
     * @param request
     * @param interactionType
     */
    protected initializeAuthorizationRequest(request: RedirectRequest|PopupRequest|SsoSilentRequest, interactionType: InteractionType): AuthorizationUrlRequest {
        this.logger.verbose("initializeAuthorizationRequest called");
        const redirectUri = this.getRedirectUri(request.redirectUri);
        const browserState: BrowserStateObject = {
            interactionType: interactionType
        };

        const state = ProtocolUtils.setRequestState(
            this.browserCrypto,
            (request && request.state) || "",
            browserState
        );

        const validatedRequest: AuthorizationUrlRequest = {
            ...this.initializeBaseRequest(request),
            redirectUri: redirectUri,
            state: state,
            nonce: request.nonce || this.browserCrypto.createNewGuid(),
            responseMode: ResponseMode.FRAGMENT
        };

        const account = request.account || this.browserStorage.getActiveAccount();
        if (account) {
            this.logger.verbose("Setting validated request account");
            this.logger.verbosePii(`Setting validated request account: ${account}`);
            validatedRequest.account = account;
        }

        // Check for ADAL/MSAL v1 SSO
        if (StringUtils.isEmpty(validatedRequest.loginHint) && !account) {
            const legacyLoginHint = this.browserStorage.getLegacyLoginHint();
            if (legacyLoginHint) {
                validatedRequest.loginHint = legacyLoginHint;
            }
        }

        this.browserStorage.updateCacheEntries(validatedRequest.state, validatedRequest.nonce, validatedRequest.authority, validatedRequest.loginHint || "", validatedRequest.account || null);

        return validatedRequest;
    }
}
