function splitCombinedSetCookie(value) {
  return value ? value.split(/,(?=\s*[^;,=]+=[^;,]*)/u) : [];
}

export function responseSetCookies(response) {
  const values =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie")];
  return values.flatMap(splitCombinedSetCookie);
}

export class CookieJar {
  #values = new Map();

  apply(response) {
    for (const serialized of responseSetCookies(response)) {
      const [pair, ...attributes] = serialized.split(";");
      const separator = pair.indexOf("=");
      if (separator < 1) throw new Error("Route returned a malformed cookie");
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      const expired = attributes.some((attribute) => {
        const normalized = attribute.trim().toLowerCase();
        return (
          normalized === "max-age=0" ||
          normalized.startsWith("expires=thu, 01 jan 1970")
        );
      });
      if (!value || expired) this.#values.delete(name);
      else {
        this.#values.set(name, {
          value,
          attributes: attributes.map((attribute) =>
            attribute.trim().toLowerCase(),
          ),
        });
      }
    }
  }

  header() {
    return [...this.#values.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, cookie]) => `${name}=${cookie.value}`)
      .join("; ");
  }

  has(nameOrPrefix) {
    return [...this.#values.keys()].some((name) =>
      name.startsWith(nameOrPrefix),
    );
  }

  attributeSets(nameOrPrefix) {
    return [...this.#values.entries()]
      .filter(([name]) => name.startsWith(nameOrPrefix))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, cookie]) => [...cookie.attributes]);
  }
}
