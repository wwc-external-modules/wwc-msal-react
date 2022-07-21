# MSAL Node Standalone Sample: Authorization Code Grant (PKCE) on Azure AD B2C

This sample demonstrates a [public client application](../../../lib/msal-node/docs/initialize-public-client-application.md) registered on Azure AD B2C. It features:

1. using [OIDC Connect protocol](https://docs.microsoft.com/azure/active-directory-b2c/openid-connect) to implement standard B2C [user-flows](https://docs.microsoft.com/azure/active-directory-b2c/user-flow-overview) to:

- sign-up/sign-in a user (with password reset/recovery)

2. using [authorization code grant](https://docs.microsoft.com/azure/active-directory-b2c/authorization-code-flow) to acquire an [Access Token](https://docs.microsoft.com/azure/active-directory-b2c/tokens-overview) and call a [protected web API](https://docs.microsoft.com/azure/active-directory-b2c/add-web-api-application?tabs=app-reg-ga) (also on Azure AD B2C)

## Registration

This sample comes with a registered application for demo purposes. If you would like to use your own **Azure AD B2C** tenant and application, follow the steps below:

1. [Create an Azure Active Directory B2C tenant](https://docs.microsoft.com/azure/active-directory-b2c/tutorial-create-tenant)
2. [Register a web application in Azure Active Directory B2C](https://docs.microsoft.com/azure/active-directory-b2c/tutorial-register-applications?tabs=app-reg-ga)
3. [Create user flows in Azure Active Directory B2C](https://docs.microsoft.com/azure/active-directory-b2c/tutorial-create-user-flows)

## Configuration

In `policies.js`, we create a `b2cPolicies` object to store authority strings for initiating each user-flow:

```javascript
const b2cPolicies = {
    authorities: {
        signUpSignIn: {
            authority: "https://fabrikamb2c.b2clogin.com/fabrikamb2c.onmicrosoft.com/B2C_1_susi",
        },
    },
    authorityDomain: "fabrikamb2c.b2clogin.com"
}
```

In `index.js`, we setup the configuration object expected by MSAL Node `publicClientApplication` class constructor:

```javascript
const publicClientConfig = {
    auth: {
        clientId: "e6e1bea3-d98f-4850-ba28-e80ed613cc72",
        authority: policies.authorities.signUpSignIn.authority, //signUpSignIn policy is our default authority
        knownAuthorities: [policies.authorityDomain], // mark your tenant's custom domain as a trusted authority
        redirectUri: "http://localhost:3000/redirect",
    },
    system: {
        loggerOptions: {
            loggerCallback(loglevel, message, containsPii) {
                console.log(message);
            },
            piiLoggingEnabled: false,
            logLevel: msal.LogLevel.Verbose,
        }
    }
};
```

MSAL enables PKCE in the Authorization Code Grant Flow by including the `codeChallenge` and `codeChallengeMethod` parameters in the request passed into `getAuthCodeUrl()` API, as well as the `codeVerifier` parameter in the second leg (`acquireTokenByCode()` API).

For generating the `codeVerifier` and the `codeChallenge` you can use the `generatePkceCodes` method in the `CryptoProvider` provided by the library as shown below.

```javascript
const cryptoProvider = new msal.CryptoProvider();
cryptoProvider.generatePkceCodes().then(pkceCodes => {
    authCodeRequest.codeChallenge = pkceCodes.challenge;
    tokenRequest.codeVerifier = pkceCodes.verifier;
});
```

You can also implement your own PKCE code generation logic or use an existing tool to manually generate a **Code Verifier** and **Code Challenge**, plugging them into the `pkceCodes` object below.

For details on implementing your own PKCE code generation logic, consult the PKCE specification `https://tools.ietf.org/html/rfc7636#section-4`

```javascript
const PKCE_CODES = {
    CHALLENGE_METHOD: "S256", // Use SHA256 Algorithm
    VERIFIER: "", // Generate a code verifier for the Auth Code Request first
    CHALLENGE: "" // Generate a code challenge from the previously generated code verifier
};
```

Implementing B2C user-flows is a matter of initiating authorization requests against the corresponding authorities. This sample demonstrates the [sign-up/sign-in](https://docs.microsoft.com/azure/active-directory-b2c/add-sign-up-and-sign-in-policy?pivots=b2c-user-flow) user-flow with [self-service password reset](https://docs.microsoft.com/azure/active-directory-b2c/add-password-reset-policy?pivots=b2c-user-flow#self-service-password-reset-recommended).

In order to keep track of these *flows*, we create some global objects and manipulate these in the rest of the application.

> :warning: In a real-world scenario, these objects will be specific to each request or user. As such, you might want to store them in a **session** variable.

```javascript
const APP_STATES = {
    SIGN_IN: "sign_in",
    CALL_API: "call_api",
}

const authCodeRequest = {
    codeChallenge: PKCE_CODES.CHALLENGE, // PKCE Code Challenge
    codeChallengeMethod: PKCE_CODES.CHALLENGE_METHOD // PKCE Code Challenge Method
};

const tokenRequest = {
    codeVerifier: PKCE_CODES.VERIFIER // PKCE Code Verifier
};
```

## Usage

### Initialize MSAL Node

```javascript
const pca = new msal.PublicClientApplication(publicClientConfig);
```

### Sign-in a user

Setup an Express route for initiating the sign-in flow:

```javascript
app.get("/login", (req, res) => {
    getAuthCode(policies.authorities.signUpSignIn.authority, [], APP_STATES.SIGN_IN, res);
})
```

### Get an authorization code

Create a helper method to prepare request parameters that will be passed to MSAL Node's `getAuthCodeUrl()` method, which triggers the first leg of auth code flow.

```javascript
const getAuthCode = (authority, scopes, state, res) => {

    // prepare the request
    authCodeRequest.authority = authority;
    authCodeRequest.scopes = scopes;
    authCodeRequest.state = state;

    tokenRequest.authority = authority;

    // request an authorization code to exchange for a token
    return pca.getAuthCodeUrl(authCodeRequest)
        .then((response) => {
            res.redirect(response);
        })
        .catch((error) => {
            res.status(500).send(error);
        });
}
```

### Handle redirect response

The second leg of the auth code flow consists of handling the redirect response from the B2C server. We do this in the `/redirect` route, responding appropriately to the `state` parameter in the query string.

> Learn more about the state parameter in requests [here](https://docs.microsoft.com/azure/active-directory-b2c/authorization-code-flow#1-get-an-authorization-code)

```javascript
// Second leg of auth code grant
app.get("/redirect", (req, res) => {

    // determine where the request comes from
    if (req.query.state === APP_STATES.SIGN_IN) {

        // prepare the request for authentication
        tokenRequest.scopes = [];
        tokenRequest.code = req.query.code;

        pca.acquireTokenByCode(tokenRequest)
            .then((response) => {
                const templateParams = { showLoginButton: false, username: response.account.username, profile: false };
                res.render("api", templateParams);
            }).catch((error) => {
                res.status(500).send(error);
            });

    } else if (req.query.state === APP_STATES.CALL_API) {

        // prepare the request for calling the web API
        tokenRequest.authority = policies.authorities.signUpSignIn.authority;
        tokenRequest.scopes = apiConfig.webApiScopes;
        tokenRequest.code = req.query.code;

        pca.acquireTokenByCode(tokenRequest)
            .then((response) => {

                // store access token somewhere
                req.session.accessToken = response.accessToken;

                // call the web API
                api.callWebApi(apiConfig.webApiUri, response.accessToken, (response) => {
                    const templateParams = { showLoginButton: false, profile: JSON.stringify(response, null, 4) };
                    res.render("api", templateParams);
                });

            }).catch((error) => {
                console.log(error);
                res.status(500).send(error);
            });

    } else {
        res.status(500).send("Unknown");
    }
});
```

### Acquire an access token

Check if there is a stored access token in memory; if not, initiate the first leg of auth code flow to request an access token. Otherwise, call the web API.

```javascript
app.get("/api", async (req, res) => {
    // If no accessToken in store, request authorization code to exchange for a token
    if (!req.session.accessToken) {
        getAuthCode(policies.authorities.signUpSignIn.authority, apiConfig.webApiScopes, APP_STATES.CALL_API, req, res);
    } else {
        // else, call the web API
        api.callWebApi(apiConfig.webApiUri, req.session.accessToken, (response) => {
            const templateParams = { showLoginButton: false, profile: JSON.stringify(response, null, 4) };
            res.render("api", templateParams);
        });
    }
});
```

> :warning: silent flow is not used with the this scenario. See [this sample](../b2c-silent-flow/README.md) for how to setup a silent token request in MSAL Node
