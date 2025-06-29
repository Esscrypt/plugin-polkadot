export class CacheManager {
    private cache: Map<string, unknown> = new Map();

    get<T = unknown>(key: string): T | undefined {
        return this.cache.get(key) as T | undefined;
    }

    set<T>(key: string, value: T): void {
        this.cache.set(key, value);
    }

    clear(): void {
        this.cache.clear();
    }
}
