/**
 * XML parsing utility functions.
 */

/** Get text content of a child element by tag name */
export function getChildText(parent: Element, tagName: string): string {
    const el = parent.getElementsByTagName(tagName)[0];
    return el?.textContent?.trim() ?? '';
}

/** Get text content as number, with default value */
export function getChildNumber(parent: Element, tagName: string, defaultValue = 0): number {
    const text = getChildText(parent, tagName);
    if (!text) return defaultValue;
    const num = parseInt(text, 10);
    return isNaN(num) ? defaultValue : num;
}

/** Get text content as boolean */
export function getChildBool(parent: Element, tagName: string, defaultValue = false): boolean {
    const text = getChildText(parent, tagName).toLowerCase();
    if (!text) return defaultValue;
    return text === 'true' || text === '1';
}

/** Get all values from a container element with <value> children */
export function getValueArray(parent: Element, containerTag: string): number[] {
    const container = parent.getElementsByTagName(containerTag)[0];
    if (!container) return [];

    const values: number[] = [];
    const valueElements = container.getElementsByTagName('value');
    for (let i = 0; i < valueElements.length; i++) {
        const text = valueElements[i].textContent?.trim() ?? '0';
        values.push(parseInt(text, 10));
    }
    return values;
}

/** Get all text values from elements with a specific tag name */
export function getTextArray(parent: Element, tagName: string): string[] {
    const elements = parent.getElementsByTagName(tagName);
    const result: string[] = [];
    for (let i = 0; i < elements.length; i++) {
        const text = elements[i].textContent?.trim();
        if (text) result.push(text);
    }
    return result;
}

/** Parse XML string to Document */
export function parseXML(xmlString: string): Document {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlString, 'text/xml');

    // Check for parse errors
    const parseError = doc.querySelector('parsererror');
    if (parseError) {
        throw new Error(`XML parse error: ${parseError.textContent}`);
    }

    return doc;
}
