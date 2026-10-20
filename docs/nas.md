# Deploying on the NAS

The hub runs as one container with a bind mount for its database. This page
covers the install, the update and the two failures that DSM causes.

The instructions assume DSM 7.2 or later, Container Manager installed, and a
shared folder at `/volume1/docker`. Adjust the paths if yours differ.

## Why the source is downloaded rather than cloned

Synology ships no `git`, and the Docker builder shells out to `git` when a build
context is a git URL. That fails with `exec: "git": executable file not found in
$PATH`. Installing Git Server and symlinking it into `/usr/local/bin` makes the
git context work, but the source is one tarball either way, so these steps skip
git entirely.

## Install

Create the project folder and give the data directory to the user the container
runs as. The image runs as uid 1000, and a bind mount keeps the owner it finds on
the host, so the first write fails without this.

```sh
sudo mkdir -p /volume1/docker/opushy-hub/data
sudo chown -R 1000:1000 /volume1/docker/opushy-hub/data
```

Download the source at a pinned commit. Replace the SHA when you deploy a newer
one.

```sh
cd /volume1/docker/opushy-hub
SHA=15530ba98ffbb2f834c55732cf3996a8a371a27b
curl -fsSL -o /tmp/hub.tar.gz "https://github.com/h1st0ry3D/opushy-hub/archive/${SHA}.tar.gz"
mkdir -p src
sudo tar -xzf /tmp/hub.tar.gz -C src --strip-components=1
ls src
```

That should print `Dockerfile`, `package.json`, `bun.lock`, `core`, `scripts`,
`src` and `web`.

Write `/volume1/docker/opushy-hub/docker-compose.yaml`:

```yaml
services:
  hub:
    build:
      context: ./src
    image: opushy-hub:0.1.0
    container_name: opushy-hub
    restart: unless-stopped
    ports:
      - "8080:8080"
    volumes:
      - ./data:/data
```

`context` points at the unpacked source rather than a git URL. `./data` is its
own directory and not the project root, so the container only writes where the
database belongs.

Build and start it:

```sh
sudo docker compose config
sudo docker compose up -d --build
sudo docker compose ps
```

`ps` shows `healthy` once the container's own healthcheck passes, which takes up
to thirty seconds. Read the token it generated on first boot:

```sh
sudo cat data/token
```

Open `http://<nas-address>:8080` on the phone and paste the token. The web app
keeps it in `localStorage`, so this happens once per device.

## Update

Pick the new commit, unpack it over the old source and rebuild. The data
directory is outside `src`, so the token and every recorded session survive.

```sh
cd /volume1/docker/opushy-hub
SHA=<new-sha>
rm -rf src && mkdir -p src
curl -fsSL -o /tmp/hub.tar.gz "https://github.com/h1st0ry3D/opushy-hub/archive/${SHA}.tar.gz"
sudo tar -xzf /tmp/hub.tar.gz -C src --strip-components=1
sudo docker compose up -d --build
sudo docker compose ps
```

Raise the image tag in the compose file at the same time, for example to
`opushy-hub:0.1.1`. The tag is what tells you later which commit is running.

Check the result:

```sh
curl -s http://127.0.0.1:8080/api/health
```

It answers with the session count and needs no token, so it is the quickest way
to confirm the container is serving after an update.

## Roll back

Deploy the previous SHA with the same steps. The database is independent of the
code, and the schema has not changed between releases so far. If a future release
does change it, the release notes will say so.

## When it fails

| Symptom | Cause and fix |
| --- | --- |
| `failed to read dockerfile: ... exec: "git"` | the build context is a git URL and DSM has no git. Use `context: ./src` as above |
| `BuildKit is enabled but the buildx component is missing` | the standalone `docker build` command needs a plugin that Container Manager does not ship. Build through `docker compose`, which carries its own |
| `permission denied` writing `/data` | the bind folder is not owned by uid 1000. Run the `chown` from the install steps |
| `address already in use` | another package holds 8080. Change the published port to `"8090:8080"` and use that port in the browser |
| `ps` shows `unhealthy` | read `sudo docker compose logs --tail 50`. A failed healthcheck usually means the port mapping or the `/data` permission |
| `curl` returns nothing on 8080 | the container is up but not listening. Check `sudo docker compose ps` for `Up` and the log for a startup error |
| `could not find an available, non-overlapping IPv4 address pool` | the default bridge ranges are used up. See the section below the table |

### The default network pool is full

Docker gives each compose project a bridge network carved out of
`172.17.0.0/16` through `172.31.0.0/16`. A NAS that has run a few projects
exhausts those ranges, and compose stops before the container starts, after the
image has already been built:

```
failed to create network opushy-hub_default: could not find an available,
non-overlapping IPv4 address pool among the defaults to assign to the network
```

Nothing needs rebuilding. Print the subnets that are taken:

```sh
sudo docker network inspect $(sudo docker network ls -q) \
  --format '{{.Name}}: {{range .IPAM.Config}}{{.Subnet}} {{end}}'
```

Then remove the networks with no container attached:

```sh
sudo docker network ls --format '{{.Name}}'
sudo docker network prune
sudo docker compose up -d
```

`prune` also deletes networks you created by hand that nothing is using, so read
the list first.

If the pool stays full, give this project a range of its own. Choose one that
does not overlap the LAN, then add it to the compose file:

```yaml
services:
  hub:
    build:
      context: ./src
    image: opushy-hub:0.1.0
    container_name: opushy-hub
    restart: unless-stopped
    ports:
      - "8080:8080"
    volumes:
      - ./data:/data
    networks:
      - hubnet

networks:
  hubnet:
    driver: bridge
    ipam:
      config:
        - subnet: 10.88.0.0/24
```

The last option is host networking, which asks for no pool at all. The app already
listens on `0.0.0.0:8080`, so remove the `ports` block, since publishing is
ignored in host mode, and set:

```yaml
    network_mode: host
```

The port then has to be free on the NAS itself. `sudo ss -ltn | grep :8080` says
whether it is.

## Verifying after an update

The database is the only state. It lives in `data/hub.sqlite` and SQLite writes a
`-wal` file beside it, so copy both if you back the folder up by hand. Hyper
Backup covers `/volume1/docker` already, and it takes the whole directory.
