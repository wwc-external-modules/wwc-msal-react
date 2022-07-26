/*
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import { AuthenticationScheme } from "../utils/Constants";

/**
 * Type representing a unique request thumbprint.
 */
export type RequestThumbprint = {
    clientId: string;
    authority: string;
    scopes: Array<string>;
    homeAccountIdentifier?: string;
    authenticationScheme?: AuthenticationScheme;
    resourceRequestMethod?: string;
    resourceRequestUri?: string;
    shrClaims?: string;
    sshJwk?: string;
    sshKid?: string;
};
