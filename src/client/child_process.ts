import * as cp from "child_process"
import * as net from "net"
import * as stream from "stream"
import { callbackify } from "util"
import { ClientProxy, ClientServerProxy } from "../common/proxy"
import { ChildProcessModuleProxy, ChildProcessProxy } from "../server/child_process"
import { ClientReadableProxy, ClientWritableProxy, Readable, Writable } from "./stream"

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface ClientChildProcessProxy extends ChildProcessProxy, ClientServerProxy<cp.ChildProcess> {}

export interface ClientChildProcessProxies {
  childProcess: ClientChildProcessProxy
  stdin?: ClientWritableProxy | null
  stdout?: ClientReadableProxy | null
  stderr?: ClientReadableProxy | null
}

export class ChildProcess extends ClientProxy<ClientChildProcessProxy> implements cp.ChildProcess {
  public readonly stdin: stream.Writable
  public readonly stdout: stream.Readable
  public readonly stderr: stream.Readable
  public readonly stdio: [stream.Writable, stream.Readable, stream.Readable]

  private _connected = false
  private _killed = false
  private _pid = -1

  public constructor(proxyPromises: Promise<ClientChildProcessProxies>) {
    super(proxyPromises.then((p) => p.childProcess))
    /* eslint-disable @typescript-eslint/no-non-null-assertion */
    this.stdin = new Writable(proxyPromises.then((p) => p.stdin!))
    this.stdout = new Readable(proxyPromises.then((p) => p.stdout!))
    this.stderr = new Readable(proxyPromises.then((p) => p.stderr!))
    /* eslint-enable @typescript-eslint/no-non-null-assertion */
    this.stdio = [this.stdin, this.stdout, this.stderr]

    this.catch(
      this.proxy.getPid().then((pid) => {
        this._pid = pid
        this._connected = true
      })
    )
    this.on("disconnect", () => (this._connected = false))
    this.on("exit", () => {
      this._connected = false
      this._killed = true
    })
  }

  public get pid(): number {
    return this._pid
  }

  public get connected(): boolean {
    return this._connected
  }

  public get killed(): boolean {
    return this._killed
  }

  public kill(): void {
    this._killed = true
    this.catch(this.proxy.kill())
  }

  public disconnect(): void {
    this.catch(this.proxy.disconnect())
  }

  public ref(): void {
    this.catch(this.proxy.ref())
  }

  public unref(): void {
    this.catch(this.proxy.unref())
  }

  public send(
    message: any,
    sendHandle?: net.Socket | net.Server | ((error: Error) => void),
    options?: cp.MessageOptions | ((error: Error) => void),
    callback?: (error: Error) => void
  ): boolean {
    if (typeof sendHandle === "function") {
      callback = sendHandle
      sendHandle = undefined
    } else if (typeof options === "function") {
      callback = options
      options = undefined
    }
    if (sendHandle || options) {
      throw new Error("sendHandle and options are not supported")
    }

    callbackify(this.proxy.send)(message, (error) => {
      if (callback) {
        callback(error)
      }
    })

    return true // Always true since we can't get this synchronously.
  }

  /**
   * Exit and close the process when disconnected.
   */
  protected handleDisconnect(): void {
    this.emit("exit", 1)
    this.emit("close")
  }
}

interface ClientChildProcessModuleProxy extends ChildProcessModuleProxy, ClientServerProxy {
  exec(
    command: string,
    options?: { encoding?: string | null } & cp.ExecOptions | null,
    callback?: (error: cp.ExecException | null, stdin: string | Buffer, stdout: string | Buffer) => void
  ): Promise<ClientChildProcessProxies>
  fork(modulePath: string, args?: string[], options?: cp.ForkOptions): Promise<ClientChildProcessProxies>
  spawn(command: string, args?: string[], options?: cp.SpawnOptions): Promise<ClientChildProcessProxies>
}

export class ChildProcessModule {
  public constructor(private readonly proxy: ClientChildProcessModuleProxy) {}

  public exec = (
    command: string,
    options?:
      | { encoding?: string | null } & cp.ExecOptions
      | null
      | ((error: cp.ExecException | null, stdout: string | Buffer, stderr: string | Buffer) => void),
    callback?: (error: cp.ExecException | null, stdout: string | Buffer, stderr: string | Buffer) => void
  ): cp.ChildProcess => {
    if (typeof options === "function") {
      callback = options
      options = undefined
    }

    const proc = new ChildProcess(this.proxy.exec(command, options))
    // If we pass the callback it'll stick around forever so we'll handle it
    // client-side instead.
    if (callback) {
      const cb = callback
      const encoding = options && options.encoding
      const stdout: any[] = []
      const stderr: any[] = []
      proc.stdout.on("data", (d) => stdout.push(d))
      proc.stderr.on("data", (d) => stderr.push(d))
      proc.once("exit", (code, signal) => {
        cb(
          code !== 0 || signal !== null ? new Error(`Command failed: ${command}`) : null,
          encoding === "utf8" ? stdout.join("") : Buffer.concat(stdout),
          encoding === "utf8" ? stderr.join("") : Buffer.concat(stderr)
        )
      })
    }
    return proc
  }

  public fork = (modulePath: string, args?: string[] | cp.ForkOptions, options?: cp.ForkOptions): cp.ChildProcess => {
    if (!Array.isArray(args)) {
      options = args
      args = undefined
    }

    return new ChildProcess(this.proxy.fork(modulePath, args, options))
  }

  public spawn = (command: string, args?: string[] | cp.SpawnOptions, options?: cp.SpawnOptions): cp.ChildProcess => {
    if (!Array.isArray(args)) {
      options = args
      args = undefined
    }

    return new ChildProcess(this.proxy.spawn(command, args, options))
  }
}
