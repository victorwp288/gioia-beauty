async function parseResponseBody(response) {
  try {
    return await response.json();
  } catch {
    return { error: "invalid_response" };
  }
}

async function postEmailDelivery(
  path,
  body,
  { idToken, fetchImpl = fetch } = {},
) {
  const headers = { "Content-Type": "application/json" };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;

  let response;
  try {
    response = await fetchImpl(path, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch {
    return {
      success: false,
      status: 0,
      error: "network_error",
      delivery: null,
    };
  }

  const payload = await parseResponseBody(response);
  return {
    success: response.ok && payload.success === true,
    status: response.status,
    error: payload.error || null,
    delivery: payload.delivery || null,
  };
}

export function sendBookingEmailRequest(body, options) {
  return postEmailDelivery("/api/send", body, options);
}

export function sendCancellationEmailRequest(body, options) {
  return postEmailDelivery("/api/cancel", body, options);
}

export function deliveryFailed(result, recipientKind) {
  return result.delivery?.[recipientKind]?.status === "failed";
}
