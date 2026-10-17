import os
import sys
from pathlib import Path

from flask import Flask, jsonify, request


BACKEND_DIR = Path(__file__).resolve().parent / "AccCreationBackend"
sys.path.insert(0, str(BACKEND_DIR))
import accountcreation as accounts


DEFAULT_FRONTEND_ORIGINS = {
    "http://localhost:5173",
    "http://127.0.0.1:5173",
}


def create_app():
    app = Flask(__name__)
    allowed_origins = {
        origin.strip()
        for origin in os.environ.get("FRONTEND_ORIGINS", "").split(",")
        if origin.strip()
    } or DEFAULT_FRONTEND_ORIGINS

    @app.after_request
    def add_cors_headers(response):
        origin = request.headers.get("Origin")
        if origin in allowed_origins:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Vary"] = "Origin"
            response.headers["Access-Control-Allow-Methods"] = "POST, OPTIONS"
            response.headers["Access-Control-Allow-Headers"] = "Content-Type"
        return response

    def read_json():
        data = request.get_json(silent=True)
        return data if isinstance(data, dict) else None

    def get_auth0_settings():
        accounts.load_env_file()
        return accounts.configured_auth0()

    @app.post("/auth/start")
    def start_sign_in():
        data = read_json()
        if data is None:
            return jsonify(error="Expected a JSON request body."), 400

        name = data.get("name")
        email = data.get("email")
        if not isinstance(name, str) or not name.strip() or len(name.strip()) > 80:
            return jsonify(error="Enter a name between 1 and 80 characters."), 400
        if not isinstance(email, str):
            return jsonify(error="Enter a valid email address."), 400

        try:
            email = accounts.validate_email(email.strip(), "Email")
            domain, client_id = get_auth0_settings()
            accounts.auth0_request_json(
                f"https://{domain}/passwordless/start",
                {
                    "client_id": client_id,
                    "connection": "email",
                    "email": email,
                    "send": "code",
                },
            )
        except ValueError as error:
            return jsonify(error=str(error)), 400
        except accounts.Auth0RequestError as error:
            return jsonify(error=str(error)), 502
        except (OSError, RuntimeError):
            return jsonify(error="Could not send the code. Check your Auth0 configuration."), 502

        return jsonify(success=True), 200

    @app.post("/auth/verify")
    def verify_sign_in():
        data = read_json()
        if data is None:
            return jsonify(error="Expected a JSON request body."), 400

        email = data.get("email")
        code = data.get("code")
        name = data.get("name")
        if not isinstance(email, str) or not isinstance(code, str) or not code.strip():
            return jsonify(error="Email and verification code are required."), 400
        if not isinstance(name, str) or not name.strip() or len(name.strip()) > 80:
            return jsonify(error="Enter a name between 1 and 80 characters."), 400

        try:
            email = accounts.validate_email(email.strip(), "Email")
            domain, client_id = get_auth0_settings()
            base_url = f"https://{domain}"
            token = accounts.auth0_request_json(
                f"{base_url}/oauth/token",
                {
                    "grant_type": "http://auth0.com/oauth/grant-type/passwordless/otp",
                    "client_id": client_id,
                    "username": email,
                    "otp": code.strip(),
                    "realm": "email",
                    "scope": "openid profile email",
                },
            )
            access_token = token.get("access_token")
            if not access_token:
                return jsonify(error="Auth0 did not return an access token."), 502

            user_info = accounts.auth0_request_json(
                f"{base_url}/userinfo", access_token=access_token
            )
            verified_email = user_info.get("email")
            user_id = user_info.get("sub")
            if not verified_email or user_info.get("email_verified") is not True or not user_id:
                return jsonify(error="Auth0 did not verify this email address."), 401

            verified_email = accounts.validate_email(verified_email, "Auth0 email")
            if verified_email.casefold() != email.casefold():
                return jsonify(error="The verified email does not match."), 401
        except accounts.Auth0RequestError as error:
            if error.error_code == "invalid_grant":
                return jsonify(error="That code is incorrect or expired."), 401
            return jsonify(error=str(error)), 502
        except (OSError, RuntimeError, ValueError):
            return jsonify(error="Could not complete Auth0 sign-in."), 502

        return jsonify(
            userId=user_id,
            name=name.strip(),
            email=verified_email,
        ), 200

    return app


app = create_app()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    app.run(host="127.0.0.1", port=port, debug=False)