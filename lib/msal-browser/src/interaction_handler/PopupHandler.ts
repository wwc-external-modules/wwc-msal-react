/*
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import { UrlString, StringUtils, CommonAuthorizationCodeRequest, AuthorizationCodeClient, Logger } from "@azure/msal-common";
import { InteractionHandler, InteractionParams } from "./InteractionHandler";
import { BrowserAuthError } from "../error/BrowserAuthError";
import { BrowserCacheManager } from "../cache/BrowserCacheManager";
import { PopupWindowAttributes, PopupUtils } from "../utils/PopupUtils";
import { BrowserUtils } from "../utils/BrowserUtils";

export type PopupParams = InteractionParams & {
    popup?: Window|null;
    popupName: string;
    popupWindowAttributes: PopupWindowAttributes
};

/**
 * This class implements the interaction handler base class for browsers. It is written specifically for handling
 * popup window scenarios. It includes functions for monitoring the popup window for a hash.
 */
export class PopupHandler extends InteractionHandler {
    private popupUtils: PopupUtils;

    constructor(authCodeModule: AuthorizationCodeClient, storageImpl: BrowserCacheManager, authCodeRequest: CommonAuthorizationCodeRequest, browserRequestLogger: Logger) {
        super(authCodeModule, storageImpl, authCodeRequest, browserRequestLogger);

        // Properly sets this reference for the unload event.
        this.popupUtils = new PopupUtils(storageImpl, browserRequestLogger);
    }

    /**
     * Opens a popup window with given request Url.
     * @param requestUrl
     */
    initiateAuthRequest(requestUrl: string, params: PopupParams): Window {
        // Check that request url is not empty.
        if (!StringUtils.isEmpty(requestUrl)) {
            // Set interaction status in the library.
            this.browserStorage.setInteractionInProgress(true);
            this.browserRequestLogger.infoPii(`Navigate to: ${requestUrl}`);
            // Open the popup window to requestUrl.
            return this.popupUtils.openPopup(requestUrl, params);
        } else {
            // Throw error if request URL is empty.
            this.browserRequestLogger.error("Navigate url is empty");
            throw BrowserAuthError.createEmptyNavigationUriError();
        }
    }

    /**
     * Monitors a window until it loads a url with a known hash, or hits a specified timeout.
     * @param popupWindow - window that is being monitored
     * @param timeout - milliseconds until timeout
     */
    monitorPopupForHash(popupWindow: Window): Promise<string> {
        return this.popupUtils.monitorPopupForSameOrigin(popupWindow).then(() => {
            const contentHash = popupWindow.location.hash;
            BrowserUtils.clearHash(popupWindow);
            this.popupUtils.cleanPopup(popupWindow);

            if (!contentHash) {
                throw BrowserAuthError.createEmptyHashError(popupWindow.location.href);
            }

            if (UrlString.hashContainsKnownProperties(contentHash)) {
                return contentHash;
            } else {
                throw BrowserAuthError.createHashDoesNotContainKnownPropertiesError();
            }
        }
        );
    }
}
