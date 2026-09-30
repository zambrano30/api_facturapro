import swaggerJsdoc from 'swagger-jsdoc'

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'FacturaPro API',
      version: '1.0.0',
      description: 'API REST para gestión de facturación, productos, clientes, empresas y más. Sistema completo para PYMEs.',
      contact: {
        name: 'FacturaPro Team',
        email: 'support@facturapro.com',
      },
      license: {
        name: 'MIT',
      },
    },
    servers: [
      {
        url: 'http://localhost:3001/api/v1',
        description: 'Development Server',
      },
      {
        url: 'https://api.facturapro.com/api/v1',
        description: 'Production Server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Enter your JWT access token',
        },
      },
      schemas: {
        User: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid', description: 'User ID' },
            email: { type: 'string', format: 'email', description: 'User email' },
            full_name: { type: 'string', description: 'User full name' },
            avatar_url: { type: 'string', nullable: true, description: 'Avatar URL' },
            role: { type: 'string', enum: ['Administrador', 'Vendedor', 'Contador', 'Gerente', 'Cocinero'], description: 'User role in company' },
            is_active: { type: 'boolean', description: 'Is user active' },
            created_at: { type: 'string', format: 'date-time', description: 'Creation timestamp' },
          },
        },
        Company: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid', description: 'Company ID' },
            name: { type: 'string', description: 'Company name' },
            legal_name: { type: 'string', nullable: true, description: 'Legal company name' },
            tax_id: { type: 'string', nullable: true, description: 'Tax identification number' },
            email: { type: 'string', nullable: true, description: 'Company email' },
            phone: { type: 'string', nullable: true, description: 'Company phone' },
            address: { type: 'string', nullable: true, description: 'Company address' },
            role: { type: 'string', description: 'User role in this company' },
            created_at: { type: 'string', format: 'date-time', description: 'Creation timestamp' },
          },
        },
        Client: {
          type: 'object',
          properties: {
            id: { type: 'integer', description: 'Client ID' },
            name: { type: 'string', description: 'Client name' },
            email: { type: 'string', nullable: true, description: 'Client email' },
            phone: { type: 'string', nullable: true, description: 'Client phone' },
            address: { type: 'string', nullable: true, description: 'Client address' },
            city: { type: 'string', nullable: true, description: 'Client city' },
            country: { type: 'string', nullable: true, description: 'Client country' },
            tax_id: { type: 'string', nullable: true, description: 'Client tax ID' },
            is_active: { type: 'boolean', description: 'Is client active' },
            created_at: { type: 'string', format: 'date-time', description: 'Creation timestamp' },
          },
        },
        Product: {
          type: 'object',
          properties: {
            id: { type: 'integer', description: 'Product ID' },
            name: { type: 'string', description: 'Product name' },
            description: { type: 'string', nullable: true, description: 'Product description' },
            sku: { type: 'string', nullable: true, description: 'Stock keeping unit' },
            barcode: { type: 'string', nullable: true, description: 'Product barcode' },
            unit_price: { type: 'number', format: 'decimal', description: 'Selling price' },
            purchase_price: { type: 'number', format: 'decimal', nullable: true, description: 'Purchase cost' },
            quantity_on_hand: { type: 'integer', description: 'Current stock quantity' },
            is_active: { type: 'boolean', description: 'Is product active' },
            created_at: { type: 'string', format: 'date-time', description: 'Creation timestamp' },
          },
        },
        Invoice: {
          type: 'object',
          properties: {
            id: { type: 'integer', description: 'Invoice ID' },
            invoice_number: { type: 'string', description: 'Invoice number' },
            client_id: { type: 'integer', description: 'Client ID' },
            status: { type: 'string', enum: ['draft', 'sent', 'paid', 'cancelled'], description: 'Invoice status' },
            invoice_date: { type: 'string', format: 'date', description: 'Invoice date' },
            due_date: { type: 'string', format: 'date', description: 'Payment due date' },
            subtotal: { type: 'number', format: 'decimal', description: 'Subtotal amount' },
            tax_amount: { type: 'number', format: 'decimal', description: 'Tax amount' },
            discount_amount: { type: 'number', format: 'decimal', nullable: true, description: 'Discount amount' },
            total_amount: { type: 'number', format: 'decimal', description: 'Total amount' },
            payment_method: { type: 'string', nullable: true, description: 'Payment method' },
            created_at: { type: 'string', format: 'date-time', description: 'Creation timestamp' },
          },
        },
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string', description: 'Error message' },
          },
        },
        HealthStatus: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['ok', 'error'] },
            database: { type: 'string', enum: ['ok', 'unavailable'] },
          },
        },
        AuthResponse: {
          type: 'object',
          properties: {
            user: { $ref: '#/components/schemas/User' },
            access_token: { type: 'string', description: 'JWT access token' },
            token_type: { type: 'string', enum: ['Bearer'] },
            expires_in: { type: 'integer', description: 'Token expiration time in seconds' },
          },
        },
      },
    },
  },
  apis: ['./src/server.js'],
}

export const swaggerSpec = swaggerJsdoc(options)
