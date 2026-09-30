# FacturaPro API - Documentación Docker

## 🐳 Configuración con Docker

Este proyecto incluye configuración completa de Docker para levantar la API y la base de datos de forma aislada.

### Requisitos

- [Docker](https://www.docker.com/products/docker-desktop) instalado
- [Docker Compose](https://docs.docker.com/compose/install/) instalado

### Inicio rápido

1. **Clonar el repositorio**
   ```bash
   git clone https://github.com/zambrano30/api_facturapro.git
   cd api_facturapro
   ```

2. **Levantar con Docker Compose**
   ```bash
   docker-compose up -d
   ```

   Esto iniciará:
   - 🗄️ MySQL en puerto `3306`
   - 🚀 API Node.js en puerto `3001`

3. **Verificar que está funcionando**
   ```bash
   curl http://localhost:3001/api/v1/health
   ```

4. **Ver logs**
   ```bash
   docker-compose logs -f api
   ```

5. **Detener servicios**
   ```bash
   docker-compose down
   ```

### Acceso a servicios

| Servicio | URL/Puerto | Credenciales |
|----------|-----------|---|
| API | http://localhost:3001 | - |
| Swagger Docs | http://localhost:3001/docs | - |
| MySQL | localhost:3306 | `root` / `Uruguay@2002` |
| Base de datos | facturapro | `facturapro_app` / `facturapro_pass` |

### Comandos útiles

**Reconstruir imágenes**
```bash
docker-compose build --no-cache
```

**Ejecutar migraciones**
```bash
docker-compose exec api npm run migrate
```

**Ver estado de contenedores**
```bash
docker-compose ps
```

**Acceder a la BD MySQL**
```bash
docker-compose exec db mysql -u root -p facturapro
```

**Limpiar todo (volúmenes incluidos)**
```bash
docker-compose down -v
```

### Variables de entorno

El archivo `docker-compose.yml` establece las siguientes variables:

```yaml
DATABASE_URL: mysql://facturapro_app:facturapro_pass@db:3306/facturapro
JWT_SECRET: abcdefghijklmnopqrstuvwxyz12345678
NODE_ENV: development
PORT: 3001
FRONTEND_URL: http://localhost:5173
```

Para cambiar valores, edita `docker-compose.yml` o crea un archivo `.env`.

### Volúmenes

- `mysql_data`: Persiste datos de la base de datos entre reinicios
- Código fuente: Montado en volumen para cambios en vivo (hot reload)

### Troubleshooting

**Puerto 3306 ya en uso**
```bash
docker-compose down
docker ps -a  # Ver contenedores
docker rm <container_id>
```

**Puerto 3001 ya en uso**
```bash
# Cambiar puerto en docker-compose.yml
# "3001:3001" → "3002:3001"
```

**La BD no inicializa**
```bash
docker-compose down -v
docker-compose up -d
```

### Deployment en Render

Para desplegar en Render con esta configuración:

1. Ir a https://render.com
2. Click "New +" → "Web Service"
3. Conectar repositorio GitHub
4. Configurar:
   - **Build Command**: `docker-compose build`
   - **Start Command**: `docker-compose up`
   - **Environment Variables**: Agregar `DATABASE_URL` con BD remota

### Desarrollo local

El volumen está configurado para hot reload. Puedes editar archivos y los cambios se reflejarán inmediatamente:

```bash
docker-compose up -d
# Edita archivos en src/
# La API se reiniciará automáticamente
```

### Base de datos remota

Para producción, usa una BD remota como:
- PlanetScale
- AWS RDS
- Railway
- DigitalOcean

Actualiza `DATABASE_URL` en `docker-compose.yml` o en las variables de entorno del servidor.
