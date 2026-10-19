// Dedicated IndexedDB: no getAll(), no in-memory Blob cache, no lossy fallback.
export class LectureStorage {
  constructor(name = "lifeos-lectures-v1") {
    this.name = name;
  }
  async open() {
    if (this.db) return this;
    this.db = await new Promise((resolve, reject) => {
      const r = indexedDB.open(this.name, 1);
      r.onupgradeneeded = () =>
        r.result.createObjectStore("items", { keyPath: "key" });
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    return this;
  }
  async operation(mode, fn) {
    await this.open();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction("items", mode),
        request = fn(tx.objectStore("items"));
      let result;
      request.onsuccess = () => {
        result = request.result;
      };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () =>
        reject(tx.error || new Error("Local save interrupted"));
    });
  }
  async put(key, value) {
    await this.operation("readwrite", (s) => s.put({ key, value }));
  }
  async get(key) {
    return (await this.operation("readonly", (s) => s.get(key)))?.value;
  }
  async remove(key) {
    await this.operation("readwrite", (s) => s.delete(key));
  }
  async keys(prefix, limit = 500) {
    await this.open();
    return new Promise((resolve, reject) => {
      const keys = [],
        tx = this.db.transaction("items", "readonly"),
        r = tx
          .objectStore("items")
          .openKeyCursor(IDBKeyRange.bound(prefix, prefix + "\uffff"));
      r.onsuccess = () => {
        const c = r.result;
        if (c && keys.length < limit) {
          keys.push(c.key);
          c.continue();
        } else resolve(keys);
      };
      r.onerror = () => reject(r.error);
    });
  }
  async mutate({puts=[],remove=[]}){await this.open();return new Promise((resolve,reject)=>{const tx=this.db.transaction('items','readwrite'),items=tx.objectStore('items');for(const [key,value]of puts)items.put({key,value});for(const key of remove)items.delete(key);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('Local ink save interrupted'));});}
  async getMany(keys){await this.open();return new Promise((resolve,reject)=>{const tx=this.db.transaction('items','readonly'),items=tx.objectStore('items'),values=new Array(keys.length);keys.forEach((key,i)=>{const r=items.get(key);r.onsuccess=()=>{values[i]=r.result?.value;};});tx.oncomplete=()=>resolve(values);tx.onerror=()=>reject(tx.error);});}
  close() {
    this.db?.close();
    this.db = null;
  }
}
