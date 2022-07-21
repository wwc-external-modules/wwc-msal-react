import { ConfidentialClientApplication } from './../../src/client/ConfidentialClientApplication';
import { Authority, ClientConfiguration,  AuthorityFactory, AuthorizationCodeClient,  RefreshTokenClient, StringUtils, ClientCredentialClient, OnBehalfOfClient, UsernamePasswordClient } from '@azure/msal-common';
import { TEST_CONSTANTS } from '../utils/TestConstants';
import { Configuration } from "../../src/config/Configuration";
import { AuthorizationCodeRequest } from "../../src/request/AuthorizationCodeRequest";
import { mocked } from 'ts-jest/utils';
import { RefreshTokenRequest } from "../../src/request/RefreshTokenRequest";
import { ClientCredentialRequest } from "../../src/request/ClientCredentialRequest";
import { OnBehalfOfRequest } from "../../src/request/OnBehalfOfRequest";
import { UsernamePasswordRequest } from '../../src/request/UsernamePasswordRequest';
import { AuthError } from "@azure/msal-common";

jest.mock('@azure/msal-common');

mocked(StringUtils.isEmpty).mockImplementation((str) => {
    return (typeof str === "undefined" || !str || 0 === str.length);
});

describe('ConfidentialClientApplication', () => {
    const authority: Authority = {
        regionDiscoveryMetadata: { region_used: undefined, region_source: undefined, region_outcome: undefined },
        resolveEndpointsAsync: () => {
            return new Promise<void>(resolve => {
                resolve();
            });
        },
        discoveryComplete: () => {
            return true;
        },
    } as Authority;

    let appConfig: Configuration = {
        auth: {
            clientId: TEST_CONSTANTS.CLIENT_ID,
            authority: TEST_CONSTANTS.AUTHORITY,
            clientSecret: TEST_CONSTANTS.CLIENT_SECRET
        },
    };

    const expectedConfig: ClientConfiguration = {
        authOptions: {
            clientId: TEST_CONSTANTS.CLIENT_ID,
            authority: authority,
            clientCapabilities: []
        },
        clientCredentials: {
            clientSecret: TEST_CONSTANTS.CLIENT_SECRET
        }
    };

    test('exports a class', () => {
        const authApp = new ConfidentialClientApplication(appConfig);
        expect(authApp).toBeInstanceOf(ConfidentialClientApplication);
    });

    test('acquireTokenByAuthorizationCode', async () => {
        const request: AuthorizationCodeRequest = {
            scopes: TEST_CONSTANTS.DEFAULT_GRAPH_SCOPE,
            redirectUri: TEST_CONSTANTS.REDIRECT_URI,
            code: TEST_CONSTANTS.AUTHORIZATION_CODE,
        };

        mocked(AuthorityFactory.createDiscoveredInstance).mockReturnValue(Promise.resolve(authority));

        const authApp = new ConfidentialClientApplication(appConfig);
        await authApp.acquireTokenByCode(request);
        expect(AuthorizationCodeClient).toHaveBeenCalledTimes(1);
        expect(AuthorizationCodeClient).toHaveBeenCalledWith(
            expect.objectContaining(expectedConfig)
        );
    });

    test('acquireTokenByRefreshToken', async () => {
        const request: RefreshTokenRequest = {
            scopes: TEST_CONSTANTS.DEFAULT_GRAPH_SCOPE,
            refreshToken: TEST_CONSTANTS.REFRESH_TOKEN,
        };

        mocked(AuthorityFactory.createDiscoveredInstance).mockReturnValue(Promise.resolve(authority));

        const authApp = new ConfidentialClientApplication(appConfig);
        await authApp.acquireTokenByRefreshToken(request);
        expect(RefreshTokenClient).toHaveBeenCalledTimes(1);
        expect(RefreshTokenClient).toHaveBeenCalledWith(
            expect.objectContaining(expectedConfig)
        );
    });

    test('acquireTokenByClientCredential', async () => {
        const request: ClientCredentialRequest = {
            scopes: TEST_CONSTANTS.DEFAULT_GRAPH_SCOPE,
            skipCache: false
        };

        mocked(AuthorityFactory.createDiscoveredInstance).mockReturnValue(Promise.resolve(authority));

        const authApp = new ConfidentialClientApplication(appConfig);
        await authApp.acquireTokenByClientCredential(request);
        expect(ClientCredentialClient).toHaveBeenCalledTimes(1);
        expect(ClientCredentialClient).toHaveBeenCalledWith(
            expect.objectContaining(expectedConfig)
        );
    });

    test('acquireTokenOnBehalfOf', async () => {
        const request: OnBehalfOfRequest = {
            scopes: TEST_CONSTANTS.DEFAULT_GRAPH_SCOPE,
            oboAssertion: TEST_CONSTANTS.ACCESS_TOKEN
        };

        mocked(AuthorityFactory.createDiscoveredInstance).mockReturnValue(Promise.resolve(authority));

        const authApp = new ConfidentialClientApplication(appConfig);
        await authApp.acquireTokenOnBehalfOf(request);
        expect(OnBehalfOfClient).toHaveBeenCalledTimes(1);
        expect(OnBehalfOfClient).toHaveBeenCalledWith(
            expect.objectContaining(expectedConfig)
        );
    });

    test('acquireTokenByUsernamePassword', async () => {
        const request: UsernamePasswordRequest = {
            scopes: TEST_CONSTANTS.DEFAULT_GRAPH_SCOPE,
            username: TEST_CONSTANTS.USERNAME,
            password: TEST_CONSTANTS.PASSWORD
        };

        mocked(AuthorityFactory.createDiscoveredInstance).mockReturnValue(Promise.resolve(authority));

        const authApp = new ConfidentialClientApplication(appConfig);
        await authApp.acquireTokenByUsernamePassword(request);
        expect(UsernamePasswordClient).toHaveBeenCalledTimes(1);
        expect(UsernamePasswordClient).toHaveBeenCalledWith(
            expect.objectContaining(expectedConfig)
        );
    });

    test('acquireTokenByClientCredential handles AuthErrors as expected', async () => {
        const request: ClientCredentialRequest = {
            scopes: TEST_CONSTANTS.DEFAULT_GRAPH_SCOPE,
            skipCache: false
        };

        mocked(AuthorityFactory.createDiscoveredInstance).mockReturnValue(Promise.resolve(authority));
        jest
            .spyOn(ClientCredentialClient.prototype, 'acquireToken')
            .mockImplementation(() => {
                throw new AuthError();
            });
        
        try {
            const authApp = new ConfidentialClientApplication(appConfig);
            await authApp.acquireTokenByClientCredential(request);
        } catch (e) {
            expect(e).toBeInstanceOf(AuthError);
            expect(AuthError.prototype.setCorrelationId).toHaveBeenCalledTimes(1);
        }
    });
});
