export class ResourceSupervisor {
  #resources = [];
  #receipt = null;

  register(name, close) {
    if (this.#receipt) throw new Error('Supervisor is already closed');
    if (typeof name !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(name)) throw new Error('Resource name is invalid');
    if (typeof close !== 'function') throw new Error('Resource close handler must be a function');
    if (this.#resources.some((resource) => resource.name === name)) throw new Error(`Resource is already registered: ${name}`);
    this.#resources.push({ name, close });
  }

  async shutdown() {
    if (this.#receipt) return this.#receipt;
    const resources = [];
    for (const resource of [...this.#resources].reverse()) {
      try {
        await resource.close();
        resources.push({ name: resource.name, closed: true });
      } catch (error) {
        resources.push({ name: resource.name, closed: false, error_type: error?.name ?? 'Error' });
      }
    }
    this.#receipt = Object.freeze({
      resources,
      resources_remaining: resources.some((resource) => !resource.closed),
    });
    return this.#receipt;
  }
}
